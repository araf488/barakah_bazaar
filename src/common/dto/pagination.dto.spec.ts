import { PaginatedResponseDto, PaginationQueryDto } from './pagination.dto';

describe('PaginationQueryDto', () => {
  it('defaults to the first page', () => {
    expect(new PaginationQueryDto().page).toBe(1);
  });

  it('defaults to a page size of 20', () => {
    expect(new PaginationQueryDto().limit).toBe(20);
  });

  it('derives a zero offset for the first page', () => {
    expect(new PaginationQueryDto().skip).toBe(0);
  });

  it('derives the offset from page and limit', () => {
    const query = Object.assign(new PaginationQueryDto(), { page: 4, limit: 25 });

    expect(query.skip).toBe(75);
  });
});

describe('PaginatedResponseDto.of', () => {
  it('reports the total page count', () => {
    expect(PaginatedResponseDto.of([], 45, 1, 20).meta.totalPages).toBe(3);
  });

  it('reports a next page when one exists', () => {
    expect(PaginatedResponseDto.of([], 45, 1, 20).meta.hasNextPage).toBe(true);
  });

  it('reports no next page on the final page', () => {
    expect(PaginatedResponseDto.of([], 45, 3, 20).meta.hasNextPage).toBe(false);
  });

  it('reports no next page when there are no results', () => {
    expect(PaginatedResponseDto.of([], 0, 1, 20).meta.hasNextPage).toBe(false);
  });

  it('reports zero pages when there are no results', () => {
    expect(PaginatedResponseDto.of([], 0, 1, 20).meta.totalPages).toBe(0);
  });

  it('carries the items through unchanged', () => {
    expect(PaginatedResponseDto.of(['a', 'b'], 2, 1, 20).items).toEqual(['a', 'b']);
  });
});
