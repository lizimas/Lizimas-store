BEGIN;

INSERT INTO color_catalog (id, name, display_order) VALUES
(1,'Black',1),(12,'Jet Black',2),(13,'Charcoal',3),(15,'Dark Grey',4),
(7,'Grey',5),(14,'Light Grey',6),(16,'Silver',7),(2,'White',8),
(17,'Off White',9),(18,'Ivory',10),(19,'Cream',11),(20,'Beige',12),
(22,'Taupe',13),(21,'Khaki',14),(23,'Tan',15),(24,'Camel',16),
(25,'Light Brown',17),(10,'Brown',18),(26,'Dark Brown',19),(27,'Chocolate',20)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_order=EXCLUDED.display_order;

INSERT INTO color_catalog (id, name, display_order) VALUES
(28,'Light Blue',21),(29,'Sky Blue',22),(35,'Aqua',23),(34,'Turquoise',24),
(33,'Teal',25),(4,'Blue',26),(32,'Royal Blue',27),(36,'Denim Blue',28),
(31,'Deep Blue',29),(30,'Navy',30),(41,'Mint',31),(43,'Sage',32),
(37,'Light Green',33),(5,'Green',34),(42,'Emerald',35),(39,'Olive',36),
(40,'Army Green',37),(38,'Dark Green',38)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_order=EXCLUDED.display_order;

INSERT INTO color_catalog (id, name, display_order) VALUES
(44,'Lemon',39),(6,'Yellow',40),(45,'Mustard',41),(46,'Gold',42),
(47,'Peach',43),(48,'Coral',44),(49,'Light Orange',45),(50,'Orange',46),
(51,'Burnt Orange',47),(52,'Rust',48),(53,'Light Pink',49),(8,'Pink',50),
(54,'Hot Pink',51),(55,'Fuchsia',52),(56,'Rose',53),(57,'Rose Gold',54),
(58,'Salmon',55),(3,'Red',56)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_order=EXCLUDED.display_order;

INSERT INTO color_catalog (id, name, display_order) VALUES
(59,'Burgundy',57),(60,'Dark Red',58),(61,'Wine',59),(62,'Maroon',60),
(63,'Lavender',61),(64,'Lilac',62),(65,'Violet',63),(9,'Purple',64),
(66,'Plum',65),(67,'Magenta',66),(11,'Champagne',67),(68,'Bronze',68),
(69,'Copper',69),(70,'Gunmetal',70),(71,'Graphite',71),(72,'Multicolour',72),
(73,'Transparent',73)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_order=EXCLUDED.display_order;

INSERT INTO size_catalog (id, name, display_order) VALUES
(1,'XS',1),(2,'S',2),(3,'M',3),(4,'L',4),(5,'XL',5),
(6,'XXL',6),(7,'3XL',7),(8,'4XL',8),(9,'5XL',9),
(10,'One Size',10),(11,'Free Size',11)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, display_order=EXCLUDED.display_order;

SELECT setval('color_catalog_id_seq', (SELECT MAX(id) FROM color_catalog));
SELECT setval('size_catalog_id_seq', (SELECT MAX(id) FROM size_catalog));

COMMIT;
