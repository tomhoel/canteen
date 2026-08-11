import type { MenuData, DishOrigin, DishDescription } from "@/lib/types";

export const INITIAL_MENU_DATA: MenuData = {
  scrapedAt: new Date().toISOString(),
  canteens: {
    "Eat the street": {
      week: "UKE / WEEK 33",
      openingHours: "11:00 - 13:30",
      menu: [],
    },
    Fresh4you: {
      week: "UKE / WEEK 33",
      openingHours: "11:00 - 13:30",
      menu: [
        {
          day: "Monday",
          no: {
            label: "MANDAG",
            items: [
              { dish: "Dagens vegetar", isMain: true, allergens: [] },
              { dish: "Norsk fiskesuppe", isMain: false, allergens: [{ id: "4", name: "Milk" }, { id: "2", name: "Fish" }] },
              { dish: "Grillede kyllingklubber med coleslaw og ris", isMain: false, allergens: [] },
            ],
          },
          en: {
            label: "MONDAY",
            items: [
              { dish: "Vegetarian of The Day", isMain: true, allergens: [] },
              { dish: "Norwegian fish soup", isMain: false, allergens: [{ id: "4", name: "Milk" }, { id: "2", name: "Fish" }] },
              { dish: "Grilled chicken with coleslaw and rice", isMain: false, allergens: [] },
            ],
          },
        },
        {
          day: "Tuesday",
          no: {
            label: "TIRSDAG",
            items: [
              { dish: "Vegan karbonade med stekte poteter", isMain: true, allergens: [] },
              { dish: "Biffkarbonader med løksaus og stekte poteter", isMain: false, allergens: [] },
            ],
          },
          en: {
            label: "TUESDAY",
            items: [
              { dish: "Vegan cutlet with fried potatoes", isMain: true, allergens: [] },
              { dish: "Beef cutlets with onion gravy", isMain: false, allergens: [] },
            ],
          },
        },
        {
          day: "Wednesday",
          no: {
            label: "ONSDAG",
            items: [
              { dish: "Vegan Bolognese med spaghetti", isMain: true, allergens: [{ id: "3", name: "Gluten" }] },
              { dish: "Wienerpølser med hjemmelaget potetmos", isMain: false, allergens: [{ id: "3", name: "Gluten" }] },
            ],
          },
          en: {
            label: "WEDNESDAY",
            items: [
              { dish: "Vegan Bolognese with spaghetti", isMain: true, allergens: [{ id: "3", name: "Gluten" }] },
              { dish: "Pork sausages with mashed potatoes", isMain: false, allergens: [{ id: "3", name: "Gluten" }] },
            ],
          },
        },
        {
          day: "Thursday",
          no: {
            label: "TORSDAG",
            items: [
              { dish: "Couscous med grønnsaker", isMain: true, allergens: [{ id: "3", name: "Gluten" }] },
              { dish: "Ovnsbakte kyllinglår med dijonsaus og ris", isMain: false, allergens: [] },
            ],
          },
          en: {
            label: "THURSDAY",
            items: [
              { dish: "Couscous with vegetables", isMain: true, allergens: [{ id: "3", name: "Gluten" }] },
              { dish: "Oven baked chicken with Dijon gravy and rice", isMain: false, allergens: [] },
            ],
          },
        },
        {
          day: "Friday",
          no: {
            label: "FREDAG",
            items: [
              { dish: "Veganburger med brød og tilbehør", isMain: true, allergens: [] },
              { dish: "Hamburger med brød og pommes frites", isMain: false, allergens: [] },
            ],
          },
          en: {
            label: "FRIDAY",
            items: [
              { dish: "Vegan burger with bread", isMain: true, allergens: [] },
              { dish: "Hamburger with fries", isMain: false, allergens: [] },
            ],
          },
        },
      ],
    },
    Flow: {
      week: "BYGG / BUILDING B - UKE/WEEK",
      openingHours: "11:00 - 13:00",
      menu: [],
    },
  },
};

export const INITIAL_DISH_ORIGINS: Record<string, DishOrigin> = {
  "Dagens vegetar": { code: "se", country: "Sweden" },
  "Couscous med grønnsaker": { code: "ma", country: "Morocco" },
  "Vegan Bolognese med spaghetti": { code: "it", country: "Italy" },
  "Vegan karbonade med stekte poteter": { code: "dk", country: "Denmark" },
  "Veganburger med brød og tilbehør": { code: "se", country: "Sweden" },
};

export const INITIAL_DISH_DESCRIPTIONS: Record<string, DishDescription> = {
  "Dagens vegetar": {
    en: "Hearty, flavorful daily vegetarian special with seasonal ingredients.",
    no: "Smakfull dagens vegetarrett med ferske sesongbaserte ingredienser.",
  },
  "Couscous med grønnsaker": {
    en: "Fluffy couscous tossed with vibrant, tender vegetables.",
    no: "Fluffy couscous blandet med livlige, møre grønnsaker.",
  },
  "Vegan Bolognese med spaghetti": {
    en: "A rich, savory plant-based Bolognese sauce over pasta.",
    no: "En fyldig, plantebasert Bolognese-saus over rykende varm pasta.",
  },
  "Vegan karbonade med stekte poteter": {
    en: "Savory vegan cutlet with crispy golden fried potatoes.",
    no: "Smakfull vegansk karbonade med sprøstekte gyldne poteter.",
  },
  "Veganburger med brød og tilbehør": {
    en: "A satisfying vegan burger on a toasted bun with sides.",
    no: "En herlig vegansk burger i ristet brød med godt tilbehør.",
  },
};
