# Meny.no API Documentation (Unofficial)

This documentation covers the internal/undocumented REST API used by the [Meny.no](https://meny.no) frontend. It can be used to programmatically search for products, list categories, retrieve store information, and manage a user's shopping cart (e.g., implementing a "Buy all from Meny" feature).

## Environment and Global Parameters

*   **API Base URL (Data):** `https://platform-rest-prod.ngdata.no`
*   **API Base URL (Frontend):** `https://meny.no/api`
*   **Chain ID (`fwc-chain-id`):** `1300` (This identifies the Meny brand within the NorgesGruppen platform).
*   **Store ID (GLN):** Most endpoints require a Global Location Number (GLN) to identify the specific physical store, as prices and availability vary. For example, `7080001150488` is MENY Bryn.

### Common Required Headers
When making requests to `platform-rest-prod.ngdata.no`, include these headers:
```http
fwc-chain-id: 1300
Content-Type: application/json
Origin: https://meny.no
Referer: https://meny.no/
```

---

## 1. Store Information (Handover Options)
Before interacting with products or the cart, you usually need to know which store the user is connected to.

**Endpoint:** `GET https://platform-rest-prod.ngdata.no/api/handoveroptions/1300`

**Response:**
Returns a list of all available stores, their addresses, geographic coordinates, and their `store_id` (GLN).

---

## 2. Product Search
Search for products using text strings.

**Endpoint:** `GET https://platform-rest-prod.ngdata.no/api/episearch/1300/products`

**Query Parameters:**
*   `search` (string): The search query (e.g., `melk`, `brød`).
*   `page_size` (int): Number of results to return per page (e.g., `20`).
*   `store_id` (string): The GLN of the store (e.g., `7080001150488`).
*   `full_response` (boolean): Set to `true` to get detailed product data.

**Example Request:**
```bash
curl "https://platform-rest-prod.ngdata.no/api/episearch/1300/products?search=melk&page_size=20&store_id=7080001150488&full_response=true" \
  -H "fwc-chain-id: 1300"
```

---

## 3. Categories and Navigation

### List All Categories
Retrieves a hierarchical list of all product categories and sub-groups.

**Endpoint:** `GET https://meny.no/api/categories`

### Get Products in a Category
Fetches products belonging to a specific category.

**Endpoint:** `GET https://platform-rest-prod.ngdata.no/api/products/1300/{store_id}`

**Query Parameters:**
*   `facet` (string): The category filter, formatted as `Categories:{CategoryName}` (e.g., `Categories:Meieri %26 egg`).
*   `page_size` (int): Items per page.

**Example Request:**
```bash
curl "https://platform-rest-prod.ngdata.no/api/products/1300/7080001150488?facet=Categories%3AMeieri%20%26%20egg&page_size=60" \
  -H "fwc-chain-id: 1300"
```

---

## 4. Product Details
Get full details for a specific item using its EAN (European Article Number).

**Endpoint:** `GET https://platform-rest-prod.ngdata.no/api/products/1300/{store_id}/{ean}`

**Example Request:**
```bash
curl "https://platform-rest-prod.ngdata.no/api/products/1300/7080001150488/5730800523724" \
  -H "fwc-chain-id: 1300"
```

---

## 5. Cart Management ("Buy All from Meny")
To add items to the user's cart, you use the "calculator" endpoint. 

> **Important Note:** This endpoint expects a `PUT` request containing the *entire* state of the desired cart. To add a new item, you must send the existing cart items plus your new item.

**Endpoint:** `PUT https://platform-rest-prod.ngdata.no/api/calculator/1300/{store_id}`

**Method:** `PUT`

**Payload Format:**
A JSON array containing objects representing the products in the cart.

```json
[
  {
    "id": "5730800523724",
    "ean": "5730800523724",
    "quantity": 1,
    "__type__": "CART_PRODUCT"
  },
  {
    "id": "7038010000065",
    "ean": "7038010000065",
    "quantity": 2,
    "__type__": "CART_PRODUCT"
  }
]
```

### Implementing "Buy All":
1. Have the list of EANs for the ingredients you want to buy (you mentioned you already map these logic elements with Kassal).
2. Get the user's currently active `store_id`.
3. (Optional but recommended) Fetch the user's current cart state so you don't overwrite items they already picked.
4. Construct the JSON array of `CART_PRODUCT` objects for your recipe's ingredients.
5. Send the `PUT` request to `/api/calculator/1300/{store_id}` with the combined array.

### Authentication & Sessions for Cart
For the cart to be saved to the user's Meny account (or their active guest session), your application needs to ensure the user is logged into Meny and that the requests carry the appropriate session cookies (like `JSESSIONID` or other authentication tokens). If you are directing the user from your app to Meny, the easiest way is often to use the Meny frontend (if they have an exposed cart import URL, though one wasn't directly found in this exploration) or to have a browser extension/client-side script perform the fetch requests relying on the browser's credentials.
