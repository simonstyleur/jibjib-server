import { z } from "zod";
import type { ItemCategory } from "../types";

const ITEM_CATEGORIES: ItemCategory[] = [
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

const itemCategoryEnum = z.enum(ITEM_CATEGORIES as [string, ...string[]]);

/**
 * Schema for adding one or more items to a list.
 * Accepts 1-50 items per request.
 */
export const addItemsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Item name is required").max(255, "Item name too long"),
        category: itemCategoryEnum.optional(),
        quantity: z.string().max(50, "Quantity too long").optional(),
        position: z.number().int().min(0).optional(),
      }),
    )
    .min(1, "At least one item is required")
    .max(50, "Cannot add more than 50 items at once"),
});

export type AddItemsInput = z.infer<typeof addItemsSchema>;

/**
 * Schema for updating a single item.
 * All fields are optional; at least one must be provided.
 */
export const updateItemSchema = z
  .object({
    name: z.string().trim().min(1, "Item name is required").max(255, "Item name too long").optional(),
    category: itemCategoryEnum.optional(),
    quantity: z.string().max(50, "Quantity too long").nullable().optional(),
    is_checked: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.category !== undefined ||
      data.quantity !== undefined ||
      data.is_checked !== undefined ||
      data.position !== undefined,
    { message: "At least one field must be provided for update" },
  );

export type UpdateItemInput = z.infer<typeof updateItemSchema>;
