import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Redis } from '@upstash/redis';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

async function getMenuVersion(): Promise<string> {
  try {
    const menuPath = path.join(process.cwd(), 'public', 'menu.json');
    const raw = await fs.readFile(menuPath, 'utf-8');
    const menu = JSON.parse(raw);
    return menu.scrapedAt || 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function POST(request: NextRequest) {
  const { dishName, lang } = await request.json();

  if (!dishName || !['no', 'en'].includes(lang)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Check Redis cache first
  const menuVersion = await getMenuVersion();
  const cacheKey = `recipe:${menuVersion}:${dishName}:${lang}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  } catch (err) {
    console.error('Redis read error:', err);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });

  const langInstruction = lang === 'no'
    ? 'Respond entirely in Norwegian (bokmål).'
    : 'Respond entirely in English.';

  const itemLocalField = lang === 'no'
    ? `\n    { "amount": "4", "unit": "fileter", "item": "Salmon", "itemLocal": "Laks" }`
    : `\n    { "amount": "4", "unit": "fillets", "item": "Salmon" }`;

  const itemLocalRule = lang === 'no'
    ? `\n- Also include an "itemLocal" field with the Norwegian name for each ingredient (e.g. "Kyllingbryst", "Olivenolje", "Hvitløk", "Løk", "Tomater", "Smør", "Mel", "Ris"). Use simple, natural Norwegian grocery names in Title Case.`
    : '';

  const promptText = `You are a warm, experienced Scandinavian home cook. Generate a practical recipe to replicate this canteen dish at home: "${dishName}".

${langInstruction}

Return ONLY valid JSON with this exact structure:
{
  "title": "Recipe title",
  "servings": 4,
  "prepTime": "15 min",
  "cookTime": "25 min",
  "ingredients": [${itemLocalField}
  ],
  "steps": ["Step 1 instruction...", "Step 2 instruction..."],
  "tip": "Optional helpful chef tip"
}

CRITICAL rules for the "item" field in ingredients:
- Use ONLY the simple base ingredient name in Title Case English, even if the recipe text is Norwegian
- Examples: "Chicken Breast", "Olive Oil", "Garlic", "Onions", "Tomatoes", "Basil", "Parmesan", "Butter", "Flour", "Rice", "Soy Sauce", "Coconut Milk", "Salmon", "Lemon", "Spinach", "Cream Cheese"
- NEVER include preparation words like "fresh", "chopped", "diced", "minced", "halved", "pitted", "sliced", "grated", "melted" in the item field
- NEVER include descriptions like "to taste", "for garnish", "optional" in the item field
- Put preparation details (chopped, diced, sliced, etc.) into the "unit" field instead. Example: { "amount": "2", "unit": "diced", "item": "Onions" }
- Keep item names to 1-3 words maximum${itemLocalRule}

Other guidelines:
- Keep it simple and achievable for a home cook
- Use metric measurements
- 4 servings default
- 4-8 ingredients typically
- 4-7 clear steps
- Include one practical tip
- Make the title appetising but not overly fancy`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite-preview',
      contents: { parts: [{ text: promptText }] },
      config: { responseMimeType: 'application/json' },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 502 });
    }

    const recipe = JSON.parse(text);

    // Cache in Redis for future requests
    try {
      await redis.set(cacheKey, recipe);
    } catch (err) {
      console.error('Redis write error:', err);
    }

    return NextResponse.json(recipe);
  } catch (error) {
    console.error('Recipe generation failed:', error);
    return NextResponse.json({ error: 'Failed to generate recipe' }, { status: 500 });
  }
}