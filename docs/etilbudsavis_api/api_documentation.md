# Tjek (eTilbudsavis) v2 API Unofficial Technical Documentation

> [!WARNING]
> This is undocumented, reverse-engineered API usage for Tjek A/S (`squid-api.tjek.com`). Endpoints, query parameters, and response structures may change without notice. No API Key or Authorization header is strictly required for read-only endpoints.

## Base URL
All requests should be prefixed with:
`https://squid-api.tjek.com/v2`

---

## 1. Dealers (Supermarket Chains)

Fetch all supported retail chains (Dealers). A dealer ID is required to filter offers by a specific chain.

**Endpoint:** `GET /dealers`

### Query Parameters
| Parameter | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `limit` | integer | Number of results to return. | 24 |
| `offset` | integer | Pagination offset. | 0 |

### Example Request
```bash
curl -s "https://squid-api.tjek.com/v2/dealers?limit=5"
```

### Example Response Snippet
```json
[
  {
    "id": "80742m",
    "name": "Extra",
    "color": "d23732",
    "country": {
      "id": "NO"
    }
  }
]
```

---

## 2. Active Catalogs (Flyers)

Fetch currently active publications (flyers/catalogs).

**Endpoint:** `GET /catalogs`

### Query Parameters
| Parameter | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `dealer_ids` | string | Comma-separated list of dealer IDs to filter by. | - |
| `limit` | integer | Number of results. | 24 |

### Example Request
```bash
curl -s "https://squid-api.tjek.com/v2/catalogs?dealer_ids=80742m&limit=1"
```

---

## 3. Offers (All Deals)

The most critical endpoint. Fetches individual offers/deals currently active.

**Endpoint:** `GET /offers`

### Query Parameters
| Parameter | Type | Description | Recommended |
| :--- | :--- | :--- | :--- |
| `dealer_ids` | string | Comma-separated dealer IDs (e.g., `80742m` for Extra). | Required to avoid global dump |
| `limit` | integer | Max items to return. | Up to 100 |

### Example Request
```bash
curl -s "https://squid-api.tjek.com/v2/offers?dealer_ids=80742m&limit=2"
```

### Response Model Highlights
The response array contains detailed `Offer` objects.
*   **`heading`**: The product name (e.g., "Tine meierismør").
*   **`description`**: Product details, often containing weight/volume.
*   **`pricing`**: Object containing `price` (float) and `currency` ("NOK").
*   **`quantity.size.to/from`**: Usually the weight (e.g., `240`). Note `quantity.unit.symbol` (e.g., "g").
*   **`run_from` / `run_till`**: ISO 8601 timestamps of deal validity.
*   **`images.zoom`**: High-resolution image URL.

---

## 4. Search Offers (Live Dynamic Querying)

Perform full-text search across all active offers. Extremely useful for AI applications looking for the cheapest specific ingredient.

**Endpoint:** `GET /offers/search`

### Query Parameters
| Parameter | Type | Description | Required |
| :--- | :--- | :--- | :--- |
| `query` | string | The search term (e.g., "kylling", "laks"). | Yes |
| `dealer_ids` | string | Comma-separated dealer IDs to restrict search context. | No |
| `limit` | integer | Max items to return. | No |

### Example Request
```bash
curl -s "https://squid-api.tjek.com/v2/offers/search?query=laks&dealer_ids=80742m&limit=3"
```

---

## 5. Physical Stores (Geolocation Filtering)

Find physical store locations based on geospatial coordinates. Useful for determining where to send users to actually buy the ingredients.

**Endpoint:** `GET /stores`

### Query Parameters
| Parameter | Type | Description | Required |
| :--- | :--- | :--- | :--- |
| `latitude` | float | Center latitude (e.g., `59.911491`). | Yes |
| `longitude` | float | Center longitude (e.g., `10.757933`). | Yes |
| `radius` | integer | Search radius in meters (e.g., `2000`). | Yes |
| `dealer_ids` | string | Comma-separated chain IDs to filter (e.g., only find Menys). | No |

### Example Request (Find stores near Oslo Central Station)
```bash
curl -s "https://squid-api.tjek.com/v2/stores?latitude=59.911491&longitude=10.757933&radius=2000&limit=2"
```

### Example Response Snippet
```json
[
  {
    "id": "abcd12",
    "street": "Biskop Gunnerus' gate 14",
    "zipcode": "0185",
    "city": "Oslo",
    "branding": {
      "name": "Meny Oslo City"
    }
  }
]
```

---

## Typical Multi-Step Implementation Flow

To build a contextual recipe generator:

1.  **Context**: The user provides their home location (`lat`/`lon`).
2.  **Lookup Stores**: Query `/stores?latitude=...` to find which supermarkets are within walking distance. Extract the `dealer_ids` from those stores.
3.  **Find Deals**: 
    *   *Option A (Push)*: Hit `/offers?dealer_ids=...` to grab all local deals. Pass the top 20 cheapest items strictly to an LLM to generate a recipe.
    *   *Option B (Pull)*: AI generates a recipe first (e.g., "Chicken Pasta"). Backend hits `/offers/search?query=kylling&dealer_ids=...` and `/offers/search?query=pasta&...` to instantly fetch the exact flyers, prices, and images for the ingredients from the user's nearest local store.
