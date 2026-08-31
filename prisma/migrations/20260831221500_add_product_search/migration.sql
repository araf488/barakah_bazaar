-- Trigram similarity, for typo tolerance. Ships with Postgres; Supabase allows it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
-- GENERATED ALWAYS: the vector cannot drift from the columns it summarises, because no
-- application code is involved in maintaining it.
--
-- Weights: A for names, B for brand, C for descriptions. ts_rank uses them, so a product
-- NAMED "almond" outranks one that merely mentions almonds in its description.
--
-- 'simple' for every field rather than 'english'. Postgres ships no Bengali stemmer, and
-- running Bengali through the English one mangles the tokens; 'simple' lowercases and splits,
-- which is the right behaviour for a language the database does not understand. The cost is
-- no English stemming either, which the trigram pass below compensates for.
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce("name_en", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("name_bn", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("brand", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("description_en", '')), 'C') ||
        setweight(to_tsvector('simple', coalesce("description_bn", '')), 'C')
    ) STORED;

-- CreateIndex
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "products_name_en_trgm_idx" ON "products" USING GIN ("name_en" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "products_brand_trgm_idx" ON "products" USING GIN ("brand" gin_trgm_ops);
