import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorMessages, formatMessage } from '../../common/constants/error-messages.constants';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ServiceResponse, serviceFail, serviceOk } from '../../common/types/service-response';
import {
  PricingMode,
  Prisma,
  Product,
  ProductVariant,
  StorageType,
} from '../../infra/prisma/prisma-client';
import { AuthService } from '../auth/auth.service';
import {
  AdminAuditActions,
  AdminAuditEntities,
  AdminConstants,
  AdminMessages,
} from './admin.constants';
import { AdminCatalogRepository, ImportProductPlan } from './admin-catalog.repository';
import { AuditLogWriteData } from './audit-log.repository';
import { Csv, CsvRow } from './csv';
import { ImportIssueDto, ImportProductsDto, ImportReportDto } from './dto/import.dto';

/** Header names the importer understands, already normalised by the CSV reader. */
const Column = {
  Slug: 'slug',
  NameEn: 'nameen',
  NameBn: 'namebn',
  CategorySlug: 'categoryslug',
  Brand: 'brand',
  PricingMode: 'pricingmode',
  IsPerishable: 'isperishable',
  ShelfLifeHours: 'shelflifehours',
  StorageType: 'storagetype',
  Sku: 'sku',
  VariantNameEn: 'variantnameen',
  VariantNameBn: 'variantnamebn',
  PricePoysha: 'pricepoysha',
  CompareAtPricePoysha: 'compareatpricepoysha',
  WeightGrams: 'weightgrams',
  UnitLabel: 'unitlabel',
} as const;

/** Reported back using the spelling an operator will recognise from their spreadsheet. */
const DISPLAY: Readonly<Record<string, string>> = {
  [Column.Slug]: 'slug',
  [Column.NameEn]: 'nameEn',
  [Column.NameBn]: 'nameBn',
  [Column.CategorySlug]: 'categorySlug',
  [Column.Sku]: 'sku',
  [Column.VariantNameEn]: 'variantNameEn',
  [Column.VariantNameBn]: 'variantNameBn',
  [Column.PricePoysha]: 'pricePoysha',
  [Column.CompareAtPricePoysha]: 'compareAtPricePoysha',
  [Column.WeightGrams]: 'weightGrams',
  [Column.UnitLabel]: 'unitLabel',
  [Column.PricingMode]: 'pricingMode',
  [Column.StorageType]: 'storageType',
};

interface DraftVariant {
  readonly line: number;
  readonly sku: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly pricePoysha: number;
  readonly compareAtPricePoysha: number | null;
  readonly weightGrams: number | null;
  readonly unitLabel: string;
}

interface DraftProduct {
  readonly line: number;
  readonly slug: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly categorySlug: string;
  readonly brand: string | null;
  readonly pricingMode: PricingMode;
  readonly isPerishable: boolean;
  readonly shelfLifeHours: number | null;
  readonly storageType: StorageType;
  variants: DraftVariant[];
}

/**
 * Bulk product import from CSV.
 *
 * One row is one VARIANT; rows sharing a slug become one product. That is the shape a
 * grocery catalog actually arrives in — the same item in 250g, 500g and 1kg — and it lets a
 * buyer maintain the file in a spreadsheet without understanding the data model.
 *
 * **Create-only, and all-or-nothing.** A slug that already exists is an error rather than an
 * update: editing live prices through a spreadsheet upload is a different, much riskier
 * feature, and conflating the two means a typo'd slug silently rewrites a real product. And
 * a partly-applied import is worse than a rejected one, because nobody can tell which half
 * landed — so every row must validate before anything is written.
 */
@Injectable()
export class AdminImportService {
  constructor(
    private readonly repository: AdminCatalogRepository,
    private readonly authService: AuthService,
    @InjectPinoLogger(AdminImportService.name) private readonly logger: PinoLogger,
  ) {}

  async importProducts(
    user: AuthenticatedUser,
    dto: ImportProductsDto,
  ): Promise<ServiceResponse<ImportReportDto>> {
    try {
      const owner = await this.authService.resolveActiveUserId(user);
      if (!owner.ok) {
        return owner;
      }

      const { rows } = Csv.parse(dto.csv);

      if (rows.length === 0) {
        return serviceFail(HttpStatus.BAD_REQUEST, AdminMessages.ImportEmpty);
      }

      if (rows.length > AdminConstants.MaxImportRows) {
        return serviceFail(
          HttpStatus.BAD_REQUEST,
          formatMessage(AdminMessages.ImportTooLargeTemplate, String(AdminConstants.MaxImportRows)),
        );
      }

      const issues: ImportIssueDto[] = [];
      const drafts = AdminImportService.readRows(rows, issues);
      const resolved = await this.resolveReferences(drafts, issues);

      if (issues.length > 0) {
        return serviceOk(AdminImportService.report(rows.length, 0, 0, issues, dto.dryRun === true));
      }

      if (dto.dryRun) {
        const variants = drafts.reduce((total, draft) => total + draft.variants.length, 0);
        return serviceOk(AdminImportService.report(rows.length, drafts.length, variants, [], true));
      }

      const written = await this.repository.importProducts(resolved, (product, created) =>
        AdminImportService.auditRow(owner.data, user, product, created),
      );

      if (written === null) {
        return serviceFail(HttpStatus.SERVICE_UNAVAILABLE, AdminMessages.AuditTrailUnavailable);
      }

      return serviceOk(
        AdminImportService.report(rows.length, written.products, written.variants, [], false),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AdminImportService.importProducts');
      return serviceFail(HttpStatus.INTERNAL_SERVER_ERROR, ErrorMessages.UnexpectedError);
    }
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** Turns rows into drafts, grouping by slug and collecting every problem it finds. */
  private static readRows(rows: readonly CsvRow[], issues: ImportIssueDto[]): DraftProduct[] {
    const bySlug = new Map<string, DraftProduct>();
    const seenSkus = new Map<string, number>();

    for (const row of rows) {
      const before = issues.length;
      const draft = AdminImportService.readProduct(row, issues);
      const variant = AdminImportService.readVariant(row, issues);

      if (issues.length !== before) {
        continue;
      }

      const duplicateSku = seenSkus.get(variant.sku.toLowerCase());
      if (duplicateSku !== undefined) {
        issues.push({
          line: row.line,
          column: DISPLAY[Column.Sku],
          message: `SKU "${variant.sku}" is already used on line ${duplicateSku}.`,
        });
        continue;
      }
      seenSkus.set(variant.sku.toLowerCase(), row.line);

      const existing = bySlug.get(draft.slug);

      if (!existing) {
        bySlug.set(draft.slug, { ...draft, variants: [variant] });
        continue;
      }

      // Rows sharing a slug describe one product, so their product columns must agree —
      // otherwise which row wins would depend on file order.
      const conflict = AdminImportService.firstDisagreement(existing, draft);
      if (conflict) {
        issues.push({
          line: row.line,
          column: conflict,
          message: `Row disagrees with line ${existing.line}, which describes the same product "${draft.slug}".`,
        });
        continue;
      }

      existing.variants.push(variant);
    }

    return [...bySlug.values()];
  }

  private static readProduct(row: CsvRow, issues: ImportIssueDto[]): DraftProduct {
    const slug = AdminImportService.required(row, Column.Slug, issues);
    const pricingMode = AdminImportService.enumValue(
      row,
      Column.PricingMode,
      PricingMode,
      PricingMode.UNIT,
      issues,
    );

    if (slug && !AdminConstants.SlugPattern.test(slug)) {
      issues.push({
        line: row.line,
        column: DISPLAY[Column.Slug],
        message: 'slug must be lowercase letters, digits and single hyphens.',
      });
    }

    return {
      line: row.line,
      slug,
      nameEn: AdminImportService.required(row, Column.NameEn, issues),
      nameBn: AdminImportService.required(row, Column.NameBn, issues),
      categorySlug: AdminImportService.required(row, Column.CategorySlug, issues),
      brand: row.values[Column.Brand] || null,
      pricingMode,
      isPerishable: AdminImportService.flag(row.values[Column.IsPerishable]),
      shelfLifeHours: AdminImportService.optionalInt(row, Column.ShelfLifeHours, issues),
      storageType: AdminImportService.enumValue(
        row,
        Column.StorageType,
        StorageType,
        StorageType.AMBIENT,
        issues,
      ),
      variants: [],
    };
  }

  private static readVariant(row: CsvRow, issues: ImportIssueDto[]): DraftVariant {
    const price = AdminImportService.requiredInt(row, Column.PricePoysha, issues);
    const compareAt = AdminImportService.optionalInt(row, Column.CompareAtPricePoysha, issues);

    if (compareAt !== null && price > 0 && compareAt <= price) {
      issues.push({
        line: row.line,
        column: DISPLAY[Column.CompareAtPricePoysha],
        message: 'compareAtPricePoysha must be higher than pricePoysha.',
      });
    }

    return {
      line: row.line,
      sku: AdminImportService.required(row, Column.Sku, issues),
      nameEn: AdminImportService.required(row, Column.VariantNameEn, issues),
      nameBn: AdminImportService.required(row, Column.VariantNameBn, issues),
      pricePoysha: price,
      compareAtPricePoysha: compareAt,
      weightGrams: AdminImportService.optionalInt(row, Column.WeightGrams, issues),
      unitLabel: AdminImportService.required(row, Column.UnitLabel, issues),
    };
  }

  /** Which product column two rows for the same slug disagree on, if any. */
  private static firstDisagreement(a: DraftProduct, b: DraftProduct): string | null {
    const fields: readonly [keyof DraftProduct, string][] = [
      ['nameEn', DISPLAY[Column.NameEn]],
      ['nameBn', DISPLAY[Column.NameBn]],
      ['categorySlug', DISPLAY[Column.CategorySlug]],
      ['pricingMode', DISPLAY[Column.PricingMode]],
      ['storageType', DISPLAY[Column.StorageType]],
    ];

    const mismatch = fields.find(([field]) => a[field] !== b[field]);
    return mismatch ? mismatch[1] : null;
  }

  // ── Reference checks ──────────────────────────────────────────────────────

  /** Resolves categories and rejects anything already in the database. */
  private async resolveReferences(
    drafts: readonly DraftProduct[],
    issues: ImportIssueDto[],
  ): Promise<ImportProductPlan[]> {
    const plans: ImportProductPlan[] = [];
    const categories = new Map<string, string>();

    for (const draft of drafts) {
      const categoryId = await this.resolveCategory(draft, categories, issues);
      const clash = await this.repository.findProductBySlug(draft.slug);

      if (clash) {
        issues.push({
          line: draft.line,
          column: DISPLAY[Column.Slug],
          message: `A product with the slug "${draft.slug}" already exists. Imports create products; edit the existing one instead.`,
        });
      }

      const skuIssue = await this.findExistingSku(draft, issues);

      if (!categoryId || clash || skuIssue) {
        continue;
      }

      if (draft.pricingMode === PricingMode.WEIGHT) {
        const missing = draft.variants.find((variant) => !variant.weightGrams);
        if (missing) {
          issues.push({
            line: missing.line,
            column: DISPLAY[Column.WeightGrams],
            message: 'weightGrams is required because this product is priced by weight.',
          });
          continue;
        }
      }

      plans.push(AdminImportService.toPlan(draft, categoryId));
    }

    return plans;
  }

  private async resolveCategory(
    draft: DraftProduct,
    cache: Map<string, string>,
    issues: ImportIssueDto[],
  ): Promise<string | null> {
    const cached = cache.get(draft.categorySlug);
    if (cached) {
      return cached;
    }

    const category = await this.repository.findCategoryBySlug(draft.categorySlug);

    if (!category || !category.isActive) {
      issues.push({
        line: draft.line,
        column: DISPLAY[Column.CategorySlug],
        message: `No active category with the slug "${draft.categorySlug}".`,
      });
      return null;
    }

    cache.set(draft.categorySlug, category.id);
    return category.id;
  }

  private async findExistingSku(draft: DraftProduct, issues: ImportIssueDto[]): Promise<boolean> {
    let found = false;

    for (const variant of draft.variants) {
      const clash = await this.repository.findVariantBySku(variant.sku);

      if (clash) {
        issues.push({
          line: variant.line,
          column: DISPLAY[Column.Sku],
          message: `The SKU "${variant.sku}" already exists in the catalog.`,
        });
        found = true;
      }
    }

    return found;
  }

  // ── Assembly ──────────────────────────────────────────────────────────────

  private static toPlan(draft: DraftProduct, categoryId: string): ImportProductPlan {
    const product: Prisma.ProductCreateInput = {
      slug: draft.slug,
      nameEn: draft.nameEn,
      nameBn: draft.nameBn,
      brand: draft.brand,
      pricingMode: draft.pricingMode,
      isPerishable: draft.isPerishable,
      shelfLifeHours: draft.shelfLifeHours,
      storageType: draft.storageType,
      category: { connect: { id: categoryId } },
    };

    return {
      product,
      variants: draft.variants.map((variant) => ({
        sku: variant.sku,
        nameEn: variant.nameEn,
        nameBn: variant.nameBn,
        pricePoysha: BigInt(variant.pricePoysha),
        compareAtPricePoysha:
          variant.compareAtPricePoysha === null ? null : BigInt(variant.compareAtPricePoysha),
        weightGrams: variant.weightGrams,
        unitLabel: variant.unitLabel,
      })),
    };
  }

  private static auditRow(
    actorId: string,
    user: AuthenticatedUser,
    product: Product,
    variants: readonly ProductVariant[],
  ): AuditLogWriteData {
    return {
      actorId,
      actorEmail: user.email ?? null,
      actorRole: user.role,
      action: AdminAuditActions.ProductsImported,
      entityType: AdminAuditEntities.Product,
      entityId: product.id,
      before: undefined,
      after: JSON.parse(
        JSON.stringify({ product, variants }, (_key, item: unknown) =>
          typeof item === 'bigint' ? Number(item) : item,
        ),
      ) as AuditLogWriteData['after'],
      requestId: null,
    };
  }

  private static report(
    totalRows: number,
    productsCreated: number,
    variantsCreated: number,
    issues: ImportIssueDto[],
    dryRun: boolean,
  ): ImportReportDto {
    return {
      dryRun,
      applied: issues.length === 0 && !dryRun,
      totalRows,
      productsCreated,
      variantsCreated,
      issues,
    };
  }

  // ── Field readers ─────────────────────────────────────────────────────────

  private static required(row: CsvRow, column: string, issues: ImportIssueDto[]): string {
    const value = row.values[column];

    if (!value) {
      issues.push({
        line: row.line,
        column: DISPLAY[column] ?? column,
        message: `${DISPLAY[column] ?? column} is required.`,
      });
      return '';
    }

    return value;
  }

  private static requiredInt(row: CsvRow, column: string, issues: ImportIssueDto[]): number {
    const raw = row.values[column];
    const parsed = Number(raw);

    if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
      issues.push({
        line: row.line,
        column: DISPLAY[column] ?? column,
        message: `${DISPLAY[column] ?? column} must be a whole number above zero.`,
      });
      return 0;
    }

    return parsed;
  }

  private static optionalInt(row: CsvRow, column: string, issues: ImportIssueDto[]): number | null {
    const raw = row.values[column];

    if (!raw) {
      return null;
    }

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({
        line: row.line,
        column: DISPLAY[column] ?? column,
        message: `${DISPLAY[column] ?? column} must be a whole number above zero when present.`,
      });
      return null;
    }

    return parsed;
  }

  private static flag(raw: string | undefined): boolean {
    return ['true', 'yes', '1', 'y'].includes((raw ?? '').toLowerCase());
  }

  private static enumValue<T extends Record<string, string>>(
    row: CsvRow,
    column: string,
    values: T,
    fallback: T[keyof T],
    issues: ImportIssueDto[],
  ): T[keyof T] {
    const raw = row.values[column];

    if (!raw) {
      return fallback;
    }

    const match = Object.values(values).find((value) => value === raw.toUpperCase());

    if (!match) {
      issues.push({
        line: row.line,
        column: DISPLAY[column] ?? column,
        message: `${DISPLAY[column] ?? column} must be one of: ${Object.values(values).join(', ')}.`,
      });
      return fallback;
    }

    return match as T[keyof T];
  }
}
