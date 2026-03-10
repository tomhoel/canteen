# Enhanced MenyView Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Improve the Meny shopping list with recipe amounts, pantry grouping, expandable alternatives, link indicators, and corrected total price.

**Architecture:** Gemini adds `pantryStaple` flag per ingredient. Route passes recipe amounts through. MenyView groups items, shows amounts, expandable alternatives, and link arrows. Total price excludes out-of-stock.

**Tech Stack:** TypeScript, Next.js API route, Gemini, React, CSS

---

## Task 1: Types + Backend

- Add `recipeAmount`, `recipeUnit`, `pantryStaple` to `MenyIngredientMatch`
- Add `pantryStaple` to `GeminiTranslation` and Gemini prompt
- Pass recipe amounts from original ingredients array to matches
- Fix `totalPrice` to exclude out-of-stock items

## Task 2: MenyView Component

- Show recipe amount/unit line on each card
- Split matched list into buy vs pantry groups
- Expandable alternatives per card (tap to toggle)
- Link indicator arrow on linkable cards
- Total price from response (already fixed server-side)

## Task 3: CSS

- Pantry section header + dimmed styling
- Alternatives expand/collapse animation
- Link arrow indicator
- Polish: spacing, mobile responsive
