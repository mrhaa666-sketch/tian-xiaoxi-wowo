import { FLOORS, FOODS } from "../world/catalog";

export const FLOOR_BY = Object.fromEntries(FLOORS.map((f) => [f.id, f]));
export const FOOD_COLORS = Object.fromEntries(FOODS.map((f) => [f.id, f.color])) as Record<string, number>;
