import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { dishName, lang } = await request.json();

  if (!dishName || !['no', 'en'].includes(lang)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });

  const langInstruction = lang === 'no'
    ? 'Respond entirely in Norwegian (bokmål).'
    : 'Respond entirely in English.';

  const promptText = `You are a warm, experienced Scandinavian home cook. Generate a practical recipe to replicate this canteen dish at home: "${dishName}".

${langInstruction}

Return ONLY valid JSON with this exact structure:
{
  "title": "Recipe title",
  "servings": 4,
  "prepTime": "15 min",
  "cookTime": "25 min",
  "ingredients": [
    { "amount": "4", "unit": "fillets", "item": "salmon" }
  ],
  "steps": ["Step 1 instruction...", "Step 2 instruction..."],
  "tip": "Optional helpful chef tip"
}

Guidelines:
- Keep it simple and achievable for a home cook
- Use metric measurements
- 4 servings default
- 4-8 ingredients typically
- 4-7 clear steps
- Include one practical tip
- Make the title appetising but not overly fancy`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-lite',
      contents: { parts: [{ text: promptText }] },
      config: { responseMimeType: 'application/json' },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 502 });
    }

    const recipe = JSON.parse(text);
    return NextResponse.json(recipe);
  } catch (error) {
    console.error('Recipe generation failed:', error);
    return NextResponse.json({ error: 'Failed to generate recipe' }, { status: 500 });
  }
}
