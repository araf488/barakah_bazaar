-- ─────────────────────────────────────────────────────────────────────────────
-- Barakah Bazaar — demo catalogue
--
-- A sample shop for the pre-launch site: 8 categories, 30 products with their
-- sizes and stock, one Dhaka warehouse and two daily delivery windows. Delivery
-- zones and fees are not here: the add_delivery_zones migration already sets
-- them for the whole country (Dhaka city, greater Dhaka, Chattogram, the rest). Prices and stock are made
-- up. Replace with the real catalogue before the shop opens to the public;
-- unpublish-demo-catalogue.sql takes these products off the shelves.
--
-- Every SKU starts with DEMO- so the sample can always be told apart from real
-- stock. Product photos are CC0 / public-domain / Unsplash-licensed images served
-- by the storefront from /images/products/ (24 of 30: ajwa dates, cow ghee, the
-- shampoo, baby wipes, miswak and rose water had no licence-safe photo that showed
-- the product, so they show the storefront's placeholder).
--
-- Run as the database owner on the VM (it is not a migration):
--   docker exec -i barakah-postgres psql -U barakah_admin -d barakah -v ON_ERROR_STOP=1 \
--     < demo-catalogue.sql
--
-- Safe to re-run: every insert skips rows that already exist (by slug, SKU,
-- warehouse code or slot label), and stock is received only for a variant that has no
-- stock at the demo warehouse yet. One transaction: all of it applies or none.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Categories ───────────────────────────────────────────────────────────
INSERT INTO categories (id, slug, name_en, name_bn, image_url, sort_order, updated_at)
SELECT gen_random_uuid(), v.slug, v.name_en, v.name_bn, v.image_url, v.sort_order, now()
FROM (VALUES
  ('dry-fruits',    'Dry Fruits & Dates', 'শুকনো ফল ও খেজুর', '/images/products/medjool-dates.webp',         1),
  ('mishti-doi',    'Mishti Doi',         'মিষ্টি দই',          '/images/products/mishti-doi.webp',            2),
  ('sweets',        'Rosmalai & Sweets',  'রসমালাই ও মিষ্টি',   '/images/products/rosmalai-box.webp',          3),
  ('fresh-fruits',  'Fresh Fruits',       'তাজা ফল',            '/images/products/himsagar-mango.webp',        4),
  ('grocery',       'Grocery',            'মুদি পণ্য',          '/images/products/organic-vegetable-box.webp', 5),
  ('baby-care',     'Baby Care',          'শিশুর যত্ন',         '/images/products/baby-massage-oil.webp',      6),
  ('mens-care',     'Men''s Care',        'পুরুষের যত্ন',       '/images/products/attar-oud.webp',             7),
  ('womens-beauty', 'Women''s Beauty',    'নারীর সৌন্দর্য',     '/images/products/henna-powder.webp',          8)
) AS v(slug, name_en, name_bn, image_url, sort_order)
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Products ─────────────────────────────────────────────────────────────
-- Perishables carry a delivery limit. With no coordinates on an address the API
-- treats "same district as the warehouse" as in range, so these reach Dhaka only.
INSERT INTO products (
  id, slug, name_en, name_bn, description_en, description_bn, category_id,
  is_perishable, shelf_life_hours, storage_type, max_delivery_distance_km,
  published_at, updated_at
)
SELECT
  gen_random_uuid(), v.slug, v.name_en, v.name_bn, v.description_en, v.description_bn, c.id,
  v.is_perishable, v.shelf_life_hours, v.storage_type::"StorageType", v.max_km,
  now(), now()
FROM (VALUES
  -- Dry fruits & dates
  ('medjool-dates', 'dry-fruits', 'Medjool Dates', 'মেজদুল খেজুর',
   'Large, soft Medjool dates with a deep caramel sweetness. Good with milk at iftar or on their own.',
   'বড়, নরম মেজদুল খেজুর, ক্যারামেলের মতো মিষ্টি। ইফতারে দুধের সাথে বা এমনিই খাওয়ার জন্য।',
   false, NULL, 'AMBIENT', NULL),
  ('ajwa-dates', 'dry-fruits', 'Ajwa Dates', 'আজওয়া খেজুর',
   'Dark, soft Ajwa dates with a rich, earthy sweetness.',
   'গাঢ় রঙের নরম আজওয়া খেজুর, স্বাদে গভীর মিষ্টি।',
   false, NULL, 'AMBIENT', NULL),
  ('cashew-nuts-w180', 'dry-fruits', 'Cashew Nuts W180', 'কাজুবাদাম W180',
   'Whole, large W180-grade cashews, lightly roasted.',
   'আস্ত, বড় W180 গ্রেডের কাজুবাদাম, হালকা ভাজা।',
   false, NULL, 'AMBIENT', NULL),
  ('almonds', 'dry-fruits', 'Almonds', 'কাঠবাদাম',
   'Whole shelled almonds for snacking, baking and kheer.',
   'খোসা ছাড়ানো আস্ত কাঠবাদাম, নাশতা, বেকিং বা পায়েসের জন্য।',
   false, NULL, 'AMBIENT', NULL),
  ('pistachios', 'dry-fruits', 'Pistachios', 'পেস্তাবাদাম',
   'Roasted pistachios in the shell, lightly salted.',
   'খোসাসহ ভাজা পেস্তাবাদাম, হালকা লবণ দেওয়া।',
   false, NULL, 'AMBIENT', NULL),
  ('raisins', 'dry-fruits', 'Raisins (Kishmish)', 'কিসমিস',
   'Plump golden raisins for polao, firni and semai.',
   'পোলাও, ফিরনি আর সেমাইয়ের জন্য মোটা সোনালি কিসমিস।',
   false, NULL, 'AMBIENT', NULL),
  ('walnuts', 'dry-fruits', 'Walnuts', 'আখরোট',
   'Shelled walnut halves with a mild, buttery taste.',
   'খোসা ছাড়ানো আখরোট, হালকা মাখনের মতো স্বাদ।',
   false, NULL, 'AMBIENT', NULL),
  -- Mishti doi
  ('mishti-doi', 'mishti-doi', 'Mishti Doi', 'মিষ্টি দই',
   'Sweet set yoghurt in a clay pot, made from whole milk. Keep chilled.',
   'মাটির হাঁড়িতে জমানো মিষ্টি দই, ঘন দুধে তৈরি। ঠান্ডায় রাখুন।',
   true, 48, 'CHILLED', 20),
  -- Sweets
  ('rosmalai-box', 'sweets', 'Rosmalai Box', 'রসমালাই বক্স',
   'Soft chhena dumplings in thick, saffron-scented malai. Keep chilled.',
   'ঘন জাফরানি মালাইয়ে ভেজানো নরম ছানার রসমালাই। ঠান্ডায় রাখুন।',
   true, 48, 'CHILLED', 20),
  ('rosogolla', 'sweets', 'Rosogolla', 'রসগোল্লা',
   'Spongy chhena balls in light sugar syrup.',
   'হালকা চিনির রসে ডোবানো স্পঞ্জের মতো নরম রসগোল্লা।',
   true, 72, 'CHILLED', 20),
  -- Fresh fruits
  ('himsagar-mango', 'fresh-fruits', 'Himsagar Mango', 'হিমসাগর আম',
   'Sweet, fibre-free Himsagar mangoes from Rajshahi, picked ripe.',
   'রাজশাহীর মিষ্টি, আঁশহীন হিমসাগর আম, পাকা অবস্থায় তোলা।',
   true, 96, 'AMBIENT', 25),
  ('sagor-banana', 'fresh-fruits', 'Sagor Banana', 'সাগর কলা',
   'Ripe sagor bananas, sold by the dozen.',
   'পাকা সাগর কলা, ডজন হিসেবে।',
   true, 72, 'AMBIENT', 25),
  ('guava', 'fresh-fruits', 'Guava', 'পেয়ারা',
   'Crisp green guavas, good with salt and chilli.',
   'কচকচে সবুজ পেয়ারা, লবণ-মরিচ দিয়ে খেতে দারুণ।',
   true, 120, 'AMBIENT', 25),
  ('pomegranate', 'fresh-fruits', 'Pomegranate', 'ডালিম',
   'Deep red pomegranates with juicy seeds.',
   'রসালো দানার গাঢ় লাল ডালিম।',
   true, 168, 'AMBIENT', 25),
  -- Grocery
  ('organic-vegetable-box', 'grocery', 'Seasonal Vegetable Box', 'মৌসুমি সবজির বক্স',
   'A box of seasonal vegetables: typically tomatoes, spinach, brinjal, green chillies and coriander.',
   'মৌসুমি সবজির বক্স: সাধারণত টমেটো, পালং শাক, বেগুন, কাঁচা মরিচ আর ধনেপাতা।',
   true, 72, 'AMBIENT', 25),
  ('chinigura-rice', 'grocery', 'Chinigura Rice', 'চিনিগুড়া চাল',
   'Small-grain aromatic rice for polao, khichuri and payesh.',
   'পোলাও, খিচুড়ি আর পায়েসের জন্য ছোট দানার সুগন্ধি চাল।',
   false, NULL, 'AMBIENT', NULL),
  ('mustard-oil', 'grocery', 'Mustard Oil', 'সরিষার তেল',
   'Pungent cold-pressed mustard oil for cooking and bhorta.',
   'রান্না আর ভর্তার জন্য ঝাঁঝালো ঘানিভাঙা সরিষার তেল।',
   false, NULL, 'AMBIENT', NULL),
  ('cow-ghee', 'grocery', 'Cow Ghee', 'গাওয়া ঘি',
   'Golden clarified butter for polao, halwa and parathas.',
   'পোলাও, হালুয়া আর পরোটার জন্য সোনালি গাওয়া ঘি।',
   false, NULL, 'AMBIENT', NULL),
  ('sundarban-honey', 'grocery', 'Sundarban Honey', 'সুন্দরবনের মধু',
   'Raw honey from the Sundarbans, unheated and unfiltered.',
   'সুন্দরবনের কাঁচা মধু, জ্বাল বা ছাঁকা ছাড়া।',
   false, NULL, 'AMBIENT', NULL),
  ('masoor-dal', 'grocery', 'Masoor Dal (Red Lentils)', 'মসুর ডাল',
   'Split red lentils that cook quickly into everyday dal.',
   'তাড়াতাড়ি সেদ্ধ হওয়া ভাঙা মসুর ডাল, প্রতিদিনের ডালের জন্য।',
   false, NULL, 'AMBIENT', NULL),
  ('turmeric-powder', 'grocery', 'Turmeric Powder', 'হলুদ গুঁড়া',
   'Bright ground turmeric for curries and marinades.',
   'তরকারি আর মেরিনেডের জন্য উজ্জ্বল হলুদ গুঁড়া।',
   false, NULL, 'AMBIENT', NULL),
  ('loose-leaf-tea', 'grocery', 'Sylhet Black Tea', 'সিলেটের কালো চা',
   'Strong loose-leaf black tea for milk tea or liquor.',
   'দুধ চা বা লিকারের জন্য কড়া খোলা কালো চা পাতা।',
   false, NULL, 'AMBIENT', NULL),
  -- Baby care
  ('baby-wipes', 'baby-care', 'Baby Wipes (Unscented)', 'বেবি ওয়াইপস (সুগন্ধিহীন)',
   'Soft, unscented wet wipes for nappy changes and hands.',
   'ডায়াপার বদলানো আর হাত মোছার জন্য নরম, সুগন্ধিহীন ভেজা টিস্যু।',
   false, NULL, 'AMBIENT', NULL),
  ('baby-massage-oil', 'baby-care', 'Baby Massage Oil', 'বেবি ম্যাসাজ অয়েল',
   'Light olive-based oil for baby massage.',
   'শিশুর ম্যাসাজের জন্য হালকা অলিভ-ভিত্তিক তেল।',
   false, NULL, 'AMBIENT', NULL),
  -- Men's care
  ('attar-oud', 'mens-care', 'Oud Attar (Alcohol-free)', 'উদ আতর (অ্যালকোহলমুক্ত)',
   'Concentrated alcohol-free oud perfume oil in a roll-on bottle.',
   'রোল-অন বোতলে ঘন, অ্যালকোহলমুক্ত উদ আতর।',
   false, NULL, 'AMBIENT', NULL),
  ('miswak', 'mens-care', 'Miswak', 'মেসওয়াক',
   'Natural arak-tree miswak sticks, individually wrapped.',
   'প্রাকৃতিক আরাক গাছের মেসওয়াক, আলাদা আলাদা মোড়কে।',
   false, NULL, 'AMBIENT', NULL),
  ('beard-oil', 'mens-care', 'Beard Oil', 'বিয়ার্ড অয়েল',
   'Light conditioning oil for beard and skin.',
   'দাড়ি আর ত্বকের যত্নে হালকা তেল।',
   false, NULL, 'AMBIENT', NULL),
  -- Women's beauty
  ('argan-oil-shampoo', 'womens-beauty', 'Argan Oil Shampoo', 'আরগান অয়েল শ্যাম্পু',
   'Sulfate-free shampoo with argan oil for dry and colour-treated hair.',
   'শুষ্ক ও রং করা চুলের জন্য আরগান অয়েলসহ সালফেটমুক্ত শ্যাম্পু।',
   false, NULL, 'AMBIENT', NULL),
  ('rose-water', 'womens-beauty', 'Rose Water', 'গোলাপজল',
   'Pure rose water for skin, and for biryani and sweets.',
   'ত্বকের যত্নে, আর বিরিয়ানি ও মিষ্টিতে ব্যবহারের জন্য খাঁটি গোলাপজল।',
   false, NULL, 'AMBIENT', NULL),
  ('henna-powder', 'womens-beauty', 'Henna Powder (Mehedi)', 'মেহেদি গুঁড়া',
   'Finely sifted henna powder for hair and hands.',
   'চুল আর হাতের জন্য মিহি করে ছাঁকা মেহেদি গুঁড়া।',
   false, NULL, 'AMBIENT', NULL)
) AS v(slug, category, name_en, name_bn, description_en, description_bn,
       is_perishable, shelf_life_hours, storage_type, max_km)
JOIN categories c ON c.slug = v.category
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Sizes (variants) and stock ───────────────────────────────────────────
-- One row per size: price in poysha (৳1 = 100), the first size of each product is
-- its default, and `stock` is what the demo warehouse receives.
CREATE TEMP TABLE demo_variants (
  product text, sku text, name_en text, name_bn text, price_poysha bigint,
  compare_at_poysha bigint, weight_grams int, unit_label text, is_default boolean, stock int
) ON COMMIT DROP;

INSERT INTO demo_variants VALUES
  ('medjool-dates',        'DEMO-MDJ-250',  '250g',       '২৫০ গ্রাম',     48000,  NULL,   250,  '250g',       true,  60),
  ('medjool-dates',        'DEMO-MDJ-500',  '500g',       '৫০০ গ্রাম',     85000,  95000,  500,  '500g',       false, 60),
  ('medjool-dates',        'DEMO-MDJ-1000', '1 kg',       '১ কেজি',       155000, NULL,   1000, '1 kg',       false, 30),
  ('ajwa-dates',           'DEMO-AJW-250',  '250g',       '২৫০ গ্রাম',     65000,  NULL,   250,  '250g',       true,  40),
  ('ajwa-dates',           'DEMO-AJW-500',  '500g',       '৫০০ গ্রাম',    120000, NULL,   500,  '500g',       false, 40),
  ('ajwa-dates',           'DEMO-AJW-1000', '1 kg',       '১ কেজি',       220000, 240000, 1000, '1 kg',       false, 20),
  ('cashew-nuts-w180',     'DEMO-CSH-150',  '150g',       '১৫০ গ্রাম',     30000,  NULL,   150,  '150g',       true,  50),
  ('cashew-nuts-w180',     'DEMO-CSH-250',  '250g',       '২৫০ গ্রাম',     48000,  NULL,   250,  '250g',       false, 50),
  ('cashew-nuts-w180',     'DEMO-CSH-500',  '500g',       '৫০০ গ্রাম',     90000,  NULL,   500,  '500g',       false, 30),
  ('almonds',              'DEMO-ALM-250',  '250g',       '২৫০ গ্রাম',     42000,  NULL,   250,  '250g',       true,  50),
  ('almonds',              'DEMO-ALM-500',  '500g',       '৫০০ গ্রাম',     80000,  NULL,   500,  '500g',       false, 30),
  ('pistachios',           'DEMO-PST-250',  '250g',       '২৫০ গ্রাম',     70000,  NULL,   250,  '250g',       true,  30),
  ('raisins',              'DEMO-RSN-250',  '250g',       '২৫০ গ্রাম',     18000,  NULL,   250,  '250g',       true,  60),
  ('raisins',              'DEMO-RSN-500',  '500g',       '৫০০ গ্রাম',     34000,  NULL,   500,  '500g',       false, 40),
  ('walnuts',              'DEMO-WAL-250',  '250g',       '২৫০ গ্রাম',     55000,  NULL,   250,  '250g',       true,  30),
  ('mishti-doi',           'DEMO-DOI-250',  '250 ml',     '২৫০ মিলি',      8000,   NULL,   NULL, '250 ml',     true,  40),
  ('mishti-doi',           'DEMO-DOI-500',  '500 ml',     '৫০০ মিলি',      14000,  NULL,   NULL, '500 ml',     false, 40),
  ('mishti-doi',           'DEMO-DOI-1000', '1 litre',    '১ লিটার',       26000,  NULL,   NULL, '1 litre',    false, 20),
  ('rosmalai-box',         'DEMO-RSM-6',    'Box of 6',   '৬ পিসের বক্স',  22000,  NULL,   NULL, 'Box of 6',   true,  30),
  ('rosmalai-box',         'DEMO-RSM-12',   'Box of 12',  '১২ পিসের বক্স', 40000,  NULL,   NULL, 'Box of 12',  false, 20),
  ('rosogolla',            'DEMO-RSG-10',   'Box of 10',  '১০ পিসের বক্স', 25000,  NULL,   NULL, 'Box of 10',  true,  30),
  ('himsagar-mango',       'DEMO-MNG-1000', '1 kg',       '১ কেজি',        32000,  NULL,   1000, '1 kg',       true,  40),
  ('himsagar-mango',       'DEMO-MNG-2000', '2 kg',       '২ কেজি',        60000,  NULL,   2000, '2 kg',       false, 20),
  ('sagor-banana',         'DEMO-BAN-12',   '1 dozen',    '১ ডজন',         12000,  NULL,   NULL, '1 dozen',    true,  40),
  ('guava',                'DEMO-GUA-1000', '1 kg',       '১ কেজি',        12000,  NULL,   1000, '1 kg',       true,  40),
  ('pomegranate',          'DEMO-POM-1000', '1 kg',       '১ কেজি',        45000,  NULL,   1000, '1 kg',       true,  30),
  ('organic-vegetable-box','DEMO-VEG-S',    'Small box',  'ছোট বক্স',      22000,  NULL,   NULL, 'Small box',  true,  20),
  ('organic-vegetable-box','DEMO-VEG-F',    'Family box', 'ফ্যামিলি বক্স', 62000,  NULL,   NULL, 'Family box', false, 15),
  ('chinigura-rice',       'DEMO-RIC-1000', '1 kg',       '১ কেজি',        16000,  NULL,   1000, '1 kg',       true,  80),
  ('chinigura-rice',       'DEMO-RIC-5000', '5 kg',       '৫ কেজি',        78000,  80000,  5000, '5 kg',       false, 40),
  ('mustard-oil',          'DEMO-MST-500',  '500 ml',     '৫০০ মিলি',      18000,  NULL,   NULL, '500 ml',     true,  60),
  ('mustard-oil',          'DEMO-MST-1000', '1 litre',    '১ লিটার',       34000,  NULL,   NULL, '1 litre',    false, 40),
  ('cow-ghee',             'DEMO-GHE-200',  '200g',       '২০০ গ্রাম',     38000,  NULL,   200,  '200g',       true,  40),
  ('cow-ghee',             'DEMO-GHE-400',  '400g',       '৪০০ গ্রাম',     72000,  NULL,   400,  '400g',       false, 30),
  ('sundarban-honey',      'DEMO-HNY-250',  '250g',       '২৫০ গ্রাম',     45000,  NULL,   250,  '250g',       true,  40),
  ('sundarban-honey',      'DEMO-HNY-500',  '500g',       '৫০০ গ্রাম',     85000,  NULL,   500,  '500g',       false, 30),
  ('masoor-dal',           'DEMO-DAL-1000', '1 kg',       '১ কেজি',        14000,  NULL,   1000, '1 kg',       true,  80),
  ('turmeric-powder',      'DEMO-TUR-200',  '200g',       '২০০ গ্রাম',     9000,   NULL,   200,  '200g',       true,  60),
  ('loose-leaf-tea',       'DEMO-TEA-400',  '400g',       '৪০০ গ্রাম',     26000,  NULL,   400,  '400g',       true,  60),
  ('baby-wipes',           'DEMO-WIP-80',   'Pack of 80', '৮০টির প্যাক',   32000,  NULL,   NULL, 'Pack of 80', true,  40),
  ('baby-massage-oil',     'DEMO-BMO-100',  '100 ml',     '১০০ মিলি',      28000,  NULL,   NULL, '100 ml',     true,  30),
  ('attar-oud',            'DEMO-ATR-6',    '6 ml',       '৬ মিলি',        45000,  NULL,   NULL, '6 ml',       true,  30),
  ('miswak',               'DEMO-MSW-3',    'Pack of 3',  '৩টির প্যাক',    9000,   NULL,   NULL, 'Pack of 3',  true,  80),
  ('beard-oil',            'DEMO-BRD-30',   '30 ml',      '৩০ মিলি',       35000,  NULL,   NULL, '30 ml',      true,  30),
  ('argan-oil-shampoo',    'DEMO-ARG-200',  '200 ml',     '২০০ মিলি',      45000,  NULL,   NULL, '200 ml',     true,  40),
  ('argan-oil-shampoo',    'DEMO-ARG-400',  '400 ml',     '৪০০ মিলি',      82000,  NULL,   NULL, '400 ml',     false, 20),
  ('rose-water',           'DEMO-ROS-250',  '250 ml',     '২৫০ মিলি',      18000,  NULL,   NULL, '250 ml',     true,  50),
  ('henna-powder',         'DEMO-HEN-100',  '100g',       '১০০ গ্রাম',     12000,  NULL,   100,  '100g',       true,  50);

INSERT INTO product_variants (
  id, product_id, sku, name_en, name_bn, price_poysha, compare_at_price_poysha,
  weight_grams, unit_label, is_default, updated_at
)
SELECT gen_random_uuid(), p.id, d.sku, d.name_en, d.name_bn, d.price_poysha, d.compare_at_poysha,
       d.weight_grams, d.unit_label, d.is_default, now()
FROM demo_variants d
JOIN products p ON p.slug = d.product
ON CONFLICT (sku) DO NOTHING;

-- ── 4. Photos ───────────────────────────────────────────────────────────────
-- One primary photo per product, added only to a product that has none yet.
INSERT INTO product_images (id, product_id, url, alt_text, sort_order, is_primary)
SELECT gen_random_uuid(), p.id, v.url, p.name_en, 0, true
FROM (VALUES
  ('almonds',               '/images/products/almonds.webp'),
  ('attar-oud',             '/images/products/attar-oud.webp'),
  ('baby-massage-oil',      '/images/products/baby-massage-oil.webp'),
  ('beard-oil',             '/images/products/beard-oil.webp'),
  ('cashew-nuts-w180',      '/images/products/cashew-nuts-w180.webp'),
  ('chinigura-rice',        '/images/products/chinigura-rice.webp'),
  ('guava',                 '/images/products/guava.webp'),
  ('henna-powder',          '/images/products/henna-powder.webp'),
  ('himsagar-mango',        '/images/products/himsagar-mango.webp'),
  ('loose-leaf-tea',        '/images/products/loose-leaf-tea.webp'),
  ('masoor-dal',            '/images/products/masoor-dal.webp'),
  ('medjool-dates',         '/images/products/medjool-dates.webp'),
  ('mishti-doi',            '/images/products/mishti-doi.webp'),
  ('mustard-oil',           '/images/products/mustard-oil.webp'),
  ('organic-vegetable-box', '/images/products/organic-vegetable-box.webp'),
  ('pistachios',            '/images/products/pistachios.webp'),
  ('pomegranate',           '/images/products/pomegranate.webp'),
  ('raisins',               '/images/products/raisins.webp'),
  ('rosmalai-box',          '/images/products/rosmalai-box.webp'),
  ('rosogolla',             '/images/products/rosogolla.webp'),
  ('sagor-banana',          '/images/products/sagor-banana.webp'),
  ('sundarban-honey',       '/images/products/sundarban-honey.webp'),
  ('turmeric-powder',       '/images/products/turmeric-powder.webp'),
  ('walnuts',               '/images/products/walnuts.webp')
) AS v(product, url)
JOIN products p ON p.slug = v.product
WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id);

-- ── 4b. Shelf order ─────────────────────────────────────────────────────────
-- "New arrivals" lists the newest publication first. Everything above was published
-- in the same instant, so the order would be arbitrary: spread it a minute apart, with
-- the products that have photos first and the placeholders last. Only products
-- published by this run move (published_at is this transaction's now()), so a re-run
-- changes nothing.
UPDATE products p
SET published_at = now() - make_interval(mins => o.pos)
FROM (VALUES
  ('medjool-dates', 0),
  ('mishti-doi', 1),
  ('rosmalai-box', 2),
  ('himsagar-mango', 3),
  ('cashew-nuts-w180', 4),
  ('sundarban-honey', 5),
  ('rosogolla', 6),
  ('pomegranate', 7),
  ('almonds', 8),
  ('chinigura-rice', 9),
  ('pistachios', 10),
  ('sagor-banana', 11),
  ('walnuts', 12),
  ('cow-ghee', 13),
  ('raisins', 14),
  ('guava', 15),
  ('mustard-oil', 16),
  ('masoor-dal', 17),
  ('loose-leaf-tea', 18),
  ('turmeric-powder', 19),
  ('organic-vegetable-box', 20),
  ('attar-oud', 21),
  ('henna-powder', 22),
  ('beard-oil', 23),
  ('baby-massage-oil', 24),
  ('ajwa-dates', 25),
  ('argan-oil-shampoo', 26),
  ('rose-water', 27),
  ('miswak', 28),
  ('baby-wipes', 29)
) AS o(slug, pos)
WHERE p.slug = o.slug AND p.published_at = now()::timestamp(3);

-- ── 5. The demo warehouse ───────────────────────────────────────────────────
-- No coordinates and no service radius: it serves every address, and perishables
-- reach Dhaka district only (see section 2). Holds chilled stock for doi and sweets.
INSERT INTO warehouses (
  id, code, name_en, name_bn, division, district, upazila, area, address_line,
  post_code, storage_types, updated_at
)
VALUES (
  gen_random_uuid(), 'DHK-DEMO', 'Dhaka hub (demo)', 'ঢাকা হাব (ডেমো)', 'Dhaka', 'Dhaka',
  'Tejgaon', NULL, 'Tejgaon Industrial Area', '1208',
  ARRAY['AMBIENT', 'CHILLED']::"StorageType"[], now()
)
ON CONFLICT (code) DO NOTHING;

-- ── 6. Stock ────────────────────────────────────────────────────────────────
-- A receipt for each demo size with no stock at the warehouse yet: one batch, the
-- matching inventory total, and the RECEIPT movement, so the stock ledger, the
-- batch and the total agree. No expiry, so the demo stays sellable.
WITH warehouse AS (
  SELECT id FROM warehouses WHERE code = 'DHK-DEMO'
),
targets AS (
  SELECT w.id AS warehouse_id, pv.id AS variant_id, d.stock
  FROM demo_variants d
  JOIN product_variants pv ON pv.sku = d.sku
  CROSS JOIN warehouse w
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory i WHERE i.warehouse_id = w.id AND i.variant_id = pv.id
  )
),
totals AS (
  INSERT INTO inventory (id, warehouse_id, variant_id, quantity_on_hand, reorder_level, updated_at)
  SELECT gen_random_uuid(), t.warehouse_id, t.variant_id, t.stock, 5, now()
  FROM targets t
  RETURNING id
),
batches AS (
  INSERT INTO inventory_batches (id, warehouse_id, variant_id, batch_code, quantity, received_at, updated_at)
  SELECT gen_random_uuid(), t.warehouse_id, t.variant_id, 'DEMO-SEED', t.stock, now(), now()
  FROM targets t
  RETURNING id, warehouse_id, variant_id, quantity
)
INSERT INTO stock_movements (id, warehouse_id, variant_id, batch_id, delta, reason, note)
SELECT gen_random_uuid(), b.warehouse_id, b.variant_id, b.id, b.quantity, 'RECEIPT', 'Demo catalogue seed'
FROM batches b;

-- ── 7. Delivery windows ─────────────────────────────────────────────────────
-- Every day (0 = Sunday … 6 = Saturday), booked at least two hours ahead.
INSERT INTO delivery_slots (
  id, warehouse_id, label_en, label_bn, start_minute, end_minute, days_of_week,
  capacity, cutoff_minutes, supports_perishable, sort_order, updated_at
)
SELECT gen_random_uuid(), w.id, v.label_en, v.label_bn, v.start_minute, v.end_minute,
       ARRAY[0, 1, 2, 3, 4, 5, 6], 40, 120, true, v.sort_order, now()
FROM (VALUES
  ('Morning',  'সকাল',  600, 780,  1),
  ('Evening',  'সন্ধ্যা', 960, 1200, 2)
) AS v(label_en, label_bn, start_minute, end_minute, sort_order)
CROSS JOIN (SELECT id FROM warehouses WHERE code = 'DHK-DEMO') w
WHERE NOT EXISTS (
  SELECT 1 FROM delivery_slots s WHERE s.warehouse_id = w.id AND s.label_en = v.label_en
);

COMMIT;
