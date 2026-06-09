interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Edamam MCP — wraps three Edamam APIs in one pack:
 *   - Nutrition Analysis API (nutrition_analysis)
 *   - Recipe Search API v2    (search_recipes)
 *   - Food Database API v2     (search_food)
 *
 * Each Edamam API has its OWN app_id + app_key. The caller passes all three
 * credential pairs as a SINGLE `_apiKey` string, comma-separated, positional
 * (nutrition, recipe, food), each pair `app_id:app_key`:
 *
 *   "<nutId>:<nutKey>,<recId>:<recKey>,<foodId>:<foodKey>"
 *
 * `_apiKey` is OPTIONAL on every tool — when omitted the gateway injects the
 * platform key. It is therefore NEVER in any `required` array.
 */


const NUTRITION_URL = 'https://api.edamam.com/api/nutrition-data';
const RECIPE_URL = 'https://api.edamam.com/api/recipes/v2';
const FOOD_URL = 'https://api.edamam.com/api/food-database/v2/parser';

const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'nutrition_analysis',
    description:
      'Analyze the nutrition of a food ingredient or recipe line and return calories, weight, diet/health labels, and a macro breakdown. Example: nutrition_analysis({ ingredient: "1 cup rice and 10 oz chickpeas" })',
    inputSchema: {
      type: 'object',
      properties: {
        ingredient: {
          type: 'string',
          description:
            'Free-text ingredient or recipe line, e.g. "1 large apple", "100g cheddar cheese", "1 cup cooked rice"',
        },
        _apiKey: {
          type: 'string',
          description:
            'Optional Edamam credentials (comma-separated nutrition,recipe,food pairs of app_id:app_key). Omit to use the platform key.',
        },
      },
      required: ['ingredient'],
    },
  },
  {
    name: 'search_recipes',
    description:
      'Search Edamam\'s recipe database by keyword with optional diet, health, and cuisine filters. Returns recipes with calories, time, servings, and ingredient lists. Example: search_recipes({ query: "chicken curry", health: "gluten-free", limit: 5 })',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Recipe search keywords, e.g. "chicken curry", "vegan brownies"',
        },
        diet: {
          type: 'string',
          description:
            'Optional diet filter, e.g. "balanced", "high-protein", "low-carb", "low-fat"',
        },
        health: {
          type: 'string',
          description:
            'Optional health label filter, e.g. "gluten-free", "vegan", "vegetarian", "peanut-free"',
        },
        cuisine: {
          type: 'string',
          description:
            'Optional cuisine type filter, e.g. "italian", "mexican", "indian", "japanese"',
        },
        limit: {
          type: 'number',
          description: 'Maximum recipes to return (default 10)',
        },
        _apiKey: {
          type: 'string',
          description:
            'Optional Edamam credentials (comma-separated nutrition,recipe,food pairs of app_id:app_key). Omit to use the platform key.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_food',
    description:
      'Search Edamam\'s food database for foods matching a query and return per-100g macros (calories, protein, fat, carbs). Example: search_food({ query: "cheddar cheese", limit: 10 })',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Food name to search for, e.g. "cheddar cheese", "banana", "almond milk"',
        },
        limit: {
          type: 'number',
          description: 'Maximum foods to return (default 15)',
        },
        _apiKey: {
          type: 'string',
          description:
            'Optional Edamam credentials (comma-separated nutrition,recipe,food pairs of app_id:app_key). Omit to use the platform key.',
        },
      },
      required: ['query'],
    },
  },
];

interface Pair {
  id: string;
  key: string;
}

// Parse the combined `_apiKey` string into up to three positional credential
// pairs: index 0 = nutrition, 1 = recipe, 2 = food. Each pair is split on the
// FIRST ':' so that keys containing ':' survive intact.
function parsePairs(apiKey: string): Array<Pair | undefined> {
  return apiKey.split(',').map((segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return undefined;
    const idx = trimmed.indexOf(':');
    if (idx === -1) return undefined;
    const id = trimmed.slice(0, idx).trim();
    const key = trimmed.slice(idx + 1).trim();
    if (!id || !key) return undefined;
    return { id, key };
  });
}

const round = (n: number | undefined | null): number | null =>
  typeof n === 'number' && isFinite(n) ? Math.round(n) : null;

// Map Edamam totalNutrients keys to friendly names, formatted as "<round> <unit>".
const NUTRIENT_NAMES: Record<string, string> = {
  ENERC_KCAL: 'calories',
  PROCNT: 'protein',
  FAT: 'fat',
  CHOCDF: 'carbs',
  FIBTG: 'fiber',
  SUGAR: 'sugar',
  NA: 'sodium',
};

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = args._apiKey as string | undefined;
  delete args._apiKey;

  try {
    if (!apiKey) {
      return { error: 'Edamam requires credentials via _apiKey or the platform key' };
    }

    const pairs = parsePairs(apiKey);

    switch (name) {
      case 'nutrition_analysis': {
        const pair = pairs[0];
        if (!pair) return { error: 'no Edamam nutrition credentials configured' };
        return await nutritionAnalysis(args.ingredient as string, pair);
      }
      case 'search_recipes': {
        const pair = pairs[1];
        if (!pair) return { error: 'no Edamam recipe credentials configured' };
        return await searchRecipes(args, pair);
      }
      case 'search_food': {
        const pair = pairs[2];
        if (!pair) return { error: 'no Edamam food credentials configured' };
        return await searchFood(args, pair);
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Shared response handler: maps Edamam's status codes to actionable errors.
// Returns the parsed JSON on success, or an error object the caller returns
// verbatim (signalled by the `__error` marker).
async function edamamFetch(
  url: string,
  input: string,
): Promise<{ ok: true; data: any } | { ok: false; error: unknown }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 401) {
    return { ok: false, error: { error: 'Edamam auth error (check credentials)' } };
  }
  if (res.status === 555 || res.status === 422) {
    return { ok: false, error: { error: 'Edamam could not process the input', input } };
  }
  if (!res.ok) {
    return { ok: false, error: { error: `Edamam error: ${res.status}` } };
  }
  const data = await res.json();
  return { ok: true, data };
}

async function nutritionAnalysis(ingredient: string, pair: Pair) {
  if (!ingredient) return { error: 'nutrition_analysis requires an `ingredient`' };

  const params = new URLSearchParams({
    app_id: pair.id,
    app_key: pair.key,
    'nutrition-type': 'cooking',
    ingr: ingredient,
  });
  const result = await edamamFetch(`${NUTRITION_URL}?${params.toString()}`, ingredient);
  if (!result.ok) return result.error;

  const data = result.data as {
    calories?: number;
    totalWeight?: number;
    dietLabels?: string[];
    healthLabels?: string[];
    totalNutrients?: Record<string, { quantity?: number; unit?: string }>;
    ingredients?: Array<{
      parsed?: Array<{ weight?: number; nutrients?: Record<string, { quantity?: number; unit?: string }> }>;
    }>;
  };

  // Some Nutrition Analysis plans aggregate to top-level calories/totalNutrients;
  // others only return the per-ingredient breakdown (ingredients[].parsed[].nutrients).
  // Fall back to summing the per-ingredient nutrients + weights so both shapes work.
  let totals = data.totalNutrients ?? {};
  let calories: number | null = data.calories ?? null;
  let weight: number | null = data.totalWeight ?? null;
  if (Object.keys(totals).length === 0) {
    const agg: Record<string, { quantity: number; unit?: string }> = {};
    let w = 0;
    for (const ing of data.ingredients ?? []) {
      for (const p of ing.parsed ?? []) {
        if (typeof p.weight === 'number') w += p.weight;
        for (const [k, v] of Object.entries(p.nutrients ?? {})) {
          if (v && typeof v.quantity === 'number') {
            if (!agg[k]) agg[k] = { quantity: 0, unit: v.unit };
            agg[k].quantity += v.quantity;
          }
        }
      }
    }
    if (Object.keys(agg).length > 0) {
      totals = agg;
      if (weight == null) weight = w || null;
      if (calories == null && agg.ENERC_KCAL) calories = agg.ENERC_KCAL.quantity;
    }
  }

  const nutrients: Record<string, string> = {};
  for (const [key, friendly] of Object.entries(NUTRIENT_NAMES)) {
    const n = totals[key];
    if (n && typeof n.quantity === 'number') {
      nutrients[friendly] = `${Math.round(n.quantity)} ${n.unit ?? ''}`.trim();
    }
  }

  return {
    calories: calories != null ? Math.round(calories) : null,
    weight_g: weight != null ? Math.round(weight) : null,
    diet_labels: data.dietLabels ?? [],
    health_labels: data.healthLabels ?? [],
    nutrients,
  };
}

async function searchRecipes(args: Record<string, unknown>, pair: Pair) {
  const query = args.query as string;
  if (!query) return { error: 'search_recipes requires a `query`' };

  const limit =
    typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10;

  const params = new URLSearchParams({
    type: 'public',
    q: query,
    app_id: pair.id,
    app_key: pair.key,
  });
  if (typeof args.diet === 'string' && args.diet) params.set('diet', args.diet as string);
  if (typeof args.health === 'string' && args.health) params.set('health', args.health as string);
  if (typeof args.cuisine === 'string' && args.cuisine)
    params.set('cuisineType', args.cuisine as string);

  // NOTE: deliberately NO `Edamam-Account-User` header — this app rejects it.
  const result = await edamamFetch(`${RECIPE_URL}?${params.toString()}`, query);
  if (!result.ok) return result.error;

  const data = result.data as {
    count?: number;
    hits?: Array<{
      recipe?: {
        label?: string;
        url?: string;
        image?: string;
        source?: string;
        calories?: number;
        totalTime?: number;
        yield?: number;
        ingredientLines?: string[];
        cuisineType?: string[];
        mealType?: string[];
        dietLabels?: string[];
        healthLabels?: string[];
      };
    }>;
  };

  const hits = (data.hits ?? []).slice(0, limit);
  return {
    count: data.count ?? hits.length,
    recipes: hits.map((h) => {
      const r = h.recipe ?? {};
      return {
        label: r.label ?? null,
        source: r.source ?? null,
        url: r.url ?? null,
        image: r.image ?? null,
        calories: round(r.calories),
        time_min: r.totalTime ?? null,
        servings: r.yield ?? null,
        cuisine: r.cuisineType ?? [],
        diet_labels: r.dietLabels ?? [],
        health_labels: r.healthLabels ?? [],
        ingredients: r.ingredientLines ?? [],
      };
    }),
  };
}

async function searchFood(args: Record<string, unknown>, pair: Pair) {
  const query = args.query as string;
  if (!query) return { error: 'search_food requires a `query`' };

  const limit =
    typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 15;

  const params = new URLSearchParams({
    ingr: query,
    app_id: pair.id,
    app_key: pair.key,
  });
  const result = await edamamFetch(`${FOOD_URL}?${params.toString()}`, query);
  if (!result.ok) return result.error;

  interface FoodNode {
    food?: {
      foodId?: string;
      label?: string;
      nutrients?: {
        ENERC_KCAL?: number;
        PROCNT?: number;
        FAT?: number;
        CHOCDF?: number;
        FIBTG?: number;
      };
      category?: string;
      categoryLabel?: string;
      image?: string;
    };
  }

  const data = result.data as { parsed?: FoodNode[]; hints?: FoodNode[] };

  const all: FoodNode[] = [...(data.parsed ?? []), ...(data.hints ?? [])];
  const seen = new Set<string>();
  const foods: Array<{
    id: string | null;
    label: string | null;
    category: string | null;
    calories_per_100g: number | null;
    protein: number | null;
    fat: number | null;
    carbs: number | null;
  }> = [];

  for (const node of all) {
    const f = node.food;
    if (!f) continue;
    const id = f.foodId ?? '';
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const n = f.nutrients ?? {};
    foods.push({
      id: f.foodId ?? null,
      label: f.label ?? null,
      category: f.categoryLabel ?? null,
      calories_per_100g: round(n.ENERC_KCAL),
      protein: n.PROCNT ?? null,
      fat: n.FAT ?? null,
      carbs: n.CHOCDF ?? null,
    });
    if (foods.length >= limit) break;
  }

  return {
    count: foods.length,
    foods,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
