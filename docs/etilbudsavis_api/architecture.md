# eTilbudsavis / Tjek API Discovery & Recipe Generator Architecture

## API Discovery Findings

eTilbudsavis (which is part of Tjek A/S) uses a surprisingly open internal API to power their frontend and mobile applications. By intercepting website traffic and exploring their SDK, we have successfully reverse-engineered the primary endpoints needed to build your recipe generator.

The core host is: `https://squid-api.tjek.com/v2`

**Key Endpoints:**
1.  **Dealers (`/dealers`)**: Returns a list of all supported grocery chains.
2.  **Catalogs (`/catalogs`)**: Returns active weekly flyers/publications.
3.  **Offers (`/offers?dealer_ids={id}`)**: Fetch all discounted products for specific chains.
4.  **Search (`/offers/search?query={term}`)**: Full-text search across all active offers! (e.g., query="kylling"). This is incredible for matching LLM-generated ingredients to live store deals on the fly.
5.  **Stores Location (`/stores?latitude={lat}&longitude={lon}&radius={m}`)**: Geospatial search to find physical store locations near the user.

**Data Extracted per Product:**
When querying an offer, the API provides highly structured data perfectly suited for a recipe generator:
*   **Name & Description**: e.g., "DSH kyllingbryst", "Ny fast lav pris. Pr pk. Med skinn. 240 g."
*   **Pricing**: Exact price (`69`), previous price (if available), and currency (`NOK`).
*   **Quantity**: Precise weight/volume data (e.g., `240` `g`, or pieces).
*   **Validity**: `run_from` and `run_till` dates (letting you know exactly when the offer expires).
*   **Images**: High-resolution, zoomable image URLs of the product.
*   **Store Info**: Which exact chain the offer belongs to.

*Limitation:* The API does *not* provide an exact structured ingredient list (e.g., "Contains: chicken, salt"). It behaves exactly like a digital flyer.

---

## Proposed Recipe Generator Architecture

To build a recipe generator based on "great products with great prices," here is the recommended technical architecture:

### 1. The Data Ingestion & Search Layer (Node.js / Python)
*   **On-Demand Pricing**: Instead of just downloading all offers, when the AI suggests an ingredient (e.g., "Chicken"), the backend can immediately hit `https://squid-api.tjek.com/v2/offers/search?query=kylling` to find the exact price at the user's preferred local store.
*   **Geo-Filtering**: The app can ask for the user's location and hit `/v2/stores?latitude=X&longitude=Y` to filter results strictly to grocery stores within a 5km radius!
*   **Database**: Stores recipes and user preferences (like specific stores or dietary requirements), while relying on the Tjek API as the live source of truth for pricing.

### 2. The AI Recipe Engine (LLM - Gemini / Claude / OpenAI)
*   **Dynamic Prompting**: A backend service takes the top 30 filtered ingredients (e.g., cheap chicken breast, discounted potatoes, broccoli on sale) and feeds them into an LLM.
*   **Prompt Example**: 
    > "You are an expert chef on a budget. Here is a list of groceries that are currently on sale in Norway, along with their prices and weights: [List]. Create 3 healthy, delicious dinner recipes that maximize the use of these sale items while requiring minimal extra pantry staples. Output in JSON format with title, instructions, and ingredients."
*   **Pricing Calculation**: The backend maps the LLM's chosen ingredients back to the eTilbudsavis data to calculate an estimated "Price per portion".

### 3. The Frontend App (React / Next.js)
*   **User Preferences**: The user lands on the page and selects their local stores (e.g., "I only want to shop at Extra and Rema 1000").
*   **Recipe Display**: Shows the AI-generated recipes tailored to those stores.
*   **Interactive Shopping List**: Under the recipe, the user sees the exact products from eTilbudsavis (using the high-quality images from the API) that they need to buy, complete with the flyer price.
*   **Direct Link**: Optionally, links back to the eTilbudsavis catalog or the grocery store's online shop if they offer home delivery (like Oda or Meny).

## Next Steps
If you are happy with this approach, I can:
1.  Write a fully functional Node.js backend script that automatically fetches the current week's offers from Extra and categorizes them.
2.  Set up a basic React or Next.js frontend prototype to visualize these offers alongside a prompt setup for the recipe generator.
3.  Implement the LLM connection to actually generate recipes based on today's live data from eTilbudsavis. 

How would you like to proceed?
