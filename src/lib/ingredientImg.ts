// Maps generic/problematic ingredient names to TheMealDB-compatible names
const MEALDB_ALIASES: Record<string, string> = {
  // Pasta types — "Pasta" doesn't exist, use specific types
  "Pasta": "Penne Rigate",
  "Penne": "Penne Rigate",
  "Noodles": "Egg Noodles",
  "Egg Noodle": "Egg Noodles",
  // Proteins
  "Beef Mince": "Minced Beef",
  "Ground Beef": "Minced Beef",
  "Mince": "Minced Beef",
  "Ground Pork": "Pork",
  "Chicken Thigh": "Chicken Thighs",
  "Steak": "Beef Fillet",
  "Bacon Strips": "Bacon",
  "Ham": "Bacon",
  "Prawns": "King Prawns",
  "Shrimp": "King Prawns",
  "White Fish": "Cod",
  "Fish Fillet": "Cod",
  "Fish": "Cod",
  // Dairy
  "Heavy Cream": "Double Cream",
  "Whipping Cream": "Double Cream",
  "Cheddar": "Cheddar Cheese",
  "Mozzarella": "Mozzarella Balls",
  "Greek Yogurt": "Greek Yoghurt",
  "Yogurt": "Greek Yoghurt",
  "Parmesan": "Parmesan Cheese",
  "Parmigiano": "Parmesan Cheese",
  // Vegetables
  "Bell Pepper": "Red Pepper",
  "Bell Peppers": "Red Pepper",
  "Green Bell Pepper": "Green Pepper",
  "Red Bell Pepper": "Red Pepper",
  "Yellow Bell Pepper": "Yellow Pepper",
  "Capsicum": "Red Pepper",
  "Scallions": "Spring Onions",
  "Green Onions": "Spring Onions",
  "Shallot": "Shallots",
  "Eggplant": "Aubergine",
  "Zucchini": "Courgettes",
  "Arugula": "Rocket",
  "Cilantro": "Coriander",
  "Corn": "Sweetcorn",
  "Sweet Corn": "Sweetcorn",
  "Pickle": "Gherkins",
  "Pickles": "Gherkins",
  "Dill Pickles": "Gherkins",
  "Snow Peas": "Sugar Snap Peas",
  "Snap Peas": "Sugar Snap Peas",
  "Greens": "Spinach",
  "Romaine": "Lettuce",
  "Salad": "Lettuce",
  "Cabbage": "White Cabbage",
  "Sweet Potato": "Sweet Potatoes",
  "Potato": "Potatoes",
  "Tomato": "Tomatoes",
  "Mushroom": "Mushrooms",
  "Carrot": "Carrots",
  "Onion": "Onions",
  "Red Onion": "Red Onions",
  // Herbs & Spices
  "Basil": "Basil Leaves",
  "Fresh Basil": "Basil Leaves",
  "Cilantro Leaves": "Coriander",
  "Chili": "Chilli",
  "Chili Flakes": "Red Chilli Flakes",
  "Red Pepper Flakes": "Red Chilli Flakes",
  "Chili Powder": "Chilli Powder",
  "Hot Sauce": "Sriracha",
  "Cumin": "Ground Cumin",
  "Coriander Powder": "Ground Coriander",
  "Cinnamon": "Cinnamon Stick",
  "Turmeric": "Turmeric Powder",
  // Pantry
  "Olive Oil": "Olive Oil",
  "Vegetable Oil": "Vegetable Oil",
  "Cooking Oil": "Vegetable Oil",
  "Oil": "Vegetable Oil",
  "Soy Sauce": "Soy Sauce",
  "Vinegar": "Red Wine Vinegar",
  "Stock": "Vegetable Stock",
  "Broth": "Vegetable Stock",
  "Chicken Broth": "Chicken Stock",
  "Chicken Stock": "Chicken Stock",
  "Beef Broth": "Beef Stock",
  "Beef Stock": "Beef Stock",
  "Flour": "Plain Flour",
  "All Purpose Flour": "Plain Flour",
  "All-Purpose Flour": "Plain Flour",
  "Brown Sugar": "Dark Brown Soft Sugar",
  "Powdered Sugar": "Icing Sugar",
  "Baking Soda": "Bicarbonate Of Soda",
  "Breadcrumbs": "Bread",
  "Panko": "Bread",
  "Coconut Milk": "Coconut Milk",
  "Cream Cheese": "Cream Cheese",
  "Sour Cream": "Soured Cream",
  "Tortilla": "Flour Tortilla",
  "Tortillas": "Flour Tortilla",
  "Pita": "Naan Bread",
  "Flatbread": "Naan Bread",
  "Rice Noodles": "Rice Noodles",
  "Sesame Oil": "Sesame Seed",
  "Honey": "Honey",
  "Maple Syrup": "Maple Syrup",
  "Lemon Juice": "Lemon",
  "Lime Juice": "Lime",
  "Orange Juice": "Orange",
  "Ketchup": "Tomato Ketchup",
  "Mayo": "Mayonnaise",
  "Mustard": "English Mustard",
  "Dijon Mustard": "English Mustard",
  "Worcestershire": "Worcestershire Sauce",
  "Peanut Butter": "Peanut Butter",
  "Pine Nuts": "Pine Nuts",
  "Walnuts": "Walnuts",
  "Almonds": "Flaked Almonds",
  "Cashews": "Cashew Nuts",
  "Sesame Seeds": "Sesame Seed",
};

// Spoonacular uses lowercase-hyphenated names — different aliases needed
const SPOON_ALIASES: Record<string, string> = {
  "Pasta": "penne",
  "Noodles": "egg-noodles",
  "Pickle": "dill-pickles",
  "Pickles": "dill-pickles",
  "Dill Pickles": "dill-pickles",
  "Gherkins": "dill-pickles",
  "Mince": "ground-beef",
  "Minced Beef": "ground-beef",
  "Ground Beef": "ground-beef",
  "Coriander": "cilantro",
  "Rocket": "arugula",
  "Aubergine": "eggplant",
  "Courgettes": "zucchini",
  "Spring Onions": "scallions",
  "Prawns": "shrimp",
  "King Prawns": "shrimp",
  "Plain Flour": "flour",
  "Caster Sugar": "sugar",
  "Double Cream": "heavy-cream",
  "Soured Cream": "sour-cream",
  "Greek Yoghurt": "greek-yogurt",
  "Sweetcorn": "corn",
  "White Cabbage": "cabbage",
  "Chilli": "chili-pepper",
  "Red Pepper": "red-bell-pepper",
  "Green Pepper": "green-bell-pepper",
  "Yellow Pepper": "yellow-bell-pepper",
  "Bicarbonate Of Soda": "baking-soda",
  "Dark Brown Soft Sugar": "brown-sugar",
  "Icing Sugar": "powdered-sugar",
  "Penne Rigate": "penne",
  "Parmesan Cheese": "parmesan",
  "Mozzarella Balls": "mozzarella",
  "Basil Leaves": "basil",
  "Cinnamon Stick": "cinnamon",
  "Turmeric Powder": "turmeric",
  "Ground Cumin": "cumin",
  "Ground Coriander": "coriander",
  "Red Chilli Flakes": "red-pepper-flakes",
  "Tomato Ketchup": "ketchup",
  "English Mustard": "mustard",
  "Worcestershire Sauce": "worcestershire-sauce",
  "Cashew Nuts": "cashews",
  "Flaked Almonds": "almonds",
  "Sesame Seed": "sesame-seeds",
  "Flour Tortilla": "flour-tortillas",
  "Naan Bread": "naan",
};

function cleanName(raw: string): string {
  return raw.trim().split(",")[0].split("(")[0].trim();
}

export function getMealDbUrl(item: string): string {
  const clean = cleanName(item);
  const mapped = MEALDB_ALIASES[clean] || clean;
  return `https://www.themealdb.com/images/ingredients/${encodeURIComponent(mapped)}-Small.png`;
}

export function getSpoonUrl(item: string): string {
  const clean = cleanName(item);
  // Check spoon aliases first, then mealdb-aliased name, then raw
  const mapped = SPOON_ALIASES[clean]
    || SPOON_ALIASES[MEALDB_ALIASES[clean] || ""]
    || clean.toLowerCase().replace(/\s+/g, "-");
  return `https://img.spoonacular.com/ingredients_100x100/${encodeURIComponent(mapped)}.jpg`;
}

export function getLetterFallback(item: string): { letter: string; color: string } {
  const letter = cleanName(item).charAt(0).toUpperCase();
  // Warm, muted palette based on first letter hash
  const colors = [
    "#c8741a", "#d9604a", "#4a9e55", "#5b8abf", "#9b6bb0",
    "#c4883a", "#6b8e6b", "#b07850", "#7a8fa6", "#a08060",
  ];
  const idx = letter.charCodeAt(0) % colors.length;
  return { letter, color: colors[idx] };
}
