# Lizimas Store — Category Tree

Agreed structure for the two-level category hierarchy.
Six parents, 31 children. Children can be added or hidden (`is_active`) as the catalogue grows.

---

## Supermarket
- Groceries
- Fruits & Vegetables
- Beverages
- Personal Care
- Bakery
- Fresh Meat & Poultry
- Toys

## Electronics
- Mobiles & Wearables
- TV
- Audio
- Computers & Accessories
- Gaming
- IT Accessories

## Apparel & Boutique
- Children's Clothing
- Women's Clothing
- Men's Clothing
- Sunglasses
- Sportswear

## Home & Living
- Kitchen Appliances
- Home Appliances
- Major Appliances
- Cooking & Dining
- Home Furniture
- Outdoor Furniture
- Décor

## Cleaning & Essentials
- Brushes
- Mops & Buckets
- Laundry Detergents
- Air Fresheners
- Storage Baskets & Organizers
- Hangers & Hooks

## Books & Stationery
- *(children to be defined)*

---

## Changes from the current flat structure

| Current | Becomes |
|---|---|
| Supermarket | Parent, unchanged |
| Boutique | Merged into **Apparel & Boutique** |
| Apparel | Merged into **Apparel & Boutique** |
| Beverages | Child of Supermarket |
| Personal Care | Child of Supermarket (its 1 product moves with it) |
| Household | Renamed **Cleaning & Essentials** |
| Home | Renamed **Home & Living** |
| Electronics | Parent, unchanged |
| — | **Books & Stationery** is new |

---

## Build order for the next session

1. `pg_dump` backup — products change category, so this is not optional
2. `ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id);`
   Existing 8 rows become parents (`parent_id IS NULL`)
3. Merges and renames per the table above
4. Seed the children
5. Admin: parent selector in the category form; tree view in the categories table
6. `/api/categories` returns nested parent → children
7. Hamburger drawer navigation (Lulu-style slide-in panel)
8. Homepage: small tiles (2 rows × 6), product sections titled by child category

## Separate frontend work (independent of the hierarchy)

- Header renamed to **Lizimas-store** (from "Lizimas & Talent Enterprise")
- Remove logo image and hero banner
- Full-width search bar directly under the header

## Open items

- Toys currently sits under Supermarket — may deserve its own parent as stock grows
- Kitchen / Home / Major Appliances overlap; watch whether customers find it confusing
- "Groceries" as a catch-all alongside Fruits & Vegetables, Bakery, Fresh Meat — consider
  renaming to "Pantry" or "Food Cupboard" if it proves ambiguous
- Cloudinary orphaned-asset cleanup still outstanding (pre-existing roadmap item)
