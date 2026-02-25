import type { ItemCategory } from "../types";

export const ITEM_CATEGORIES: Record<ItemCategory, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  seafood: "Seafood",
  bakery: "Bakery",
  frozen: "Frozen",
  canned: "Canned Goods",
  snacks: "Snacks",
  beverages: "Beverages",
  household: "Household",
  personal_care: "Personal Care",
  baby: "Baby",
  pet: "Pet",
  other: "Other",
};

export const CATEGORY_ORDER: ItemCategory[] = [
  "produce",
  "dairy",
  "meat",
  "seafood",
  "bakery",
  "frozen",
  "canned",
  "snacks",
  "beverages",
  "household",
  "personal_care",
  "baby",
  "pet",
  "other",
];
