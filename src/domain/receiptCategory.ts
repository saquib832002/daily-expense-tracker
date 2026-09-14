/**
 * Working out what a bill was FOR, from what is printed on it.
 *
 * The previous version of this looked only at shop names. Its whole vocabulary
 * was signage — "supermarket", "pharmacy", "swiggy", "amazon" — so it worked
 * on a recognisable chain and failed completely on the shop most people
 * actually buy from. A bill headed SHRI BALAJI STORES listing MILK, ATTA, DAL
 * and SUGAR matched nothing at all, because none of those words were anywhere
 * in the app. It was reading the sign above the door and ignoring the basket.
 *
 * So there are two vocabularies here and they are treated differently:
 *
 *   **Shop terms** are strong. "Apollo Pharmacy" on the masthead settles the
 *   question on its own — the name of the business tells you the business.
 *
 *   **Item terms** are weak individually and strong together. One packet of
 *   biscuits on a bill proves nothing; milk AND atta AND dal AND sugar is a
 *   grocery run and nothing else. So items are counted, never trusted singly.
 *
 * Two rules keep it honest:
 *
 *   Items are read only from the ITEM REGION — between the masthead and the
 *   totals. A restaurant's address in the footer must not turn a chemist's
 *   bill into a meal out, and "thank you, visit again" must not vote at all.
 *
 *   Nothing is chosen without evidence worth showing. Every guess carries the
 *   words it matched on, and a guess that cannot clear the threshold returns
 *   null. An unchosen category is a two-second tap; a confidently wrong one
 *   teaches people to distrust the whole scanner.
 *
 * All of it is plain string matching against a table — no model, no network,
 * no per-request cost. It runs offline on a five-year-old phone.
 */

/** How much one matched term is worth. */
type Weight = 1 | 2;

interface Lexicon {
  key: string;
  /** Words that name the business. Worth `SHOP_WEIGHT` each. */
  shop?: string[];
  /** Goods that appear as line items. Ordinary weight. */
  items?: string[];
  /**
   * Goods that point at this category but plausibly belong to another —
   * "coffee" is a café and also a jar in a grocery bag. Half a vote.
   */
  weak?: string[];
}

/** A shop name is worth three items: the sign is better evidence than a jar. */
const SHOP_WEIGHT = 3;
const ITEM_WEIGHT: Weight = 2;
const WEAK_WEIGHT: Weight = 1;

/**
 * Enough evidence to fill the field in for someone.
 * One shop term (3) clears it. Two solid items (4) clear it. One item does not.
 */
const MIN_SCORE = 3;

/**
 * The vocabulary.
 *
 * Data rather than code, so widening it is a table edit and never a release
 * of new logic. Weighted towards India and the Gulf because that is where the
 * users are, with the international chains that show up everywhere.
 *
 * Everything is matched lowercase, and multi-word terms are matched as
 * substrings, so "reliance fresh" catches "RELIANCE FRESH LTD".
 */
const LEXICON: Lexicon[] = [
  {
    key: 'category.groceries',
    shop: [
      'supermarket', 'super market', 'hypermarket', 'grocery', 'groceries', 'kirana',
      'provision', 'general store', 'dmart', 'd-mart', 'big bazaar', 'bigbasket',
      'reliance fresh', 'more retail', 'departmental', 'provision stores',
      'super store', 'lulu hypermarket', 'carrefour', 'spinneys', 'nesto',
      'blinkit', 'zepto', 'instamart', 'किराना',
    ],
    items: [
      // Staples — the strongest signal there is. Nobody buys atta at a cinema.
      'atta', 'maida', 'basmati', 'rice', 'wheat', 'flour', 'dal', 'daal', 'toor',
      'moong', 'chana', 'rajma', 'besan', 'poha', 'sooji', 'suji', 'rava', 'sugar',
      'salt', 'jaggery', 'gud', 'oil', 'sunflower', 'mustard oil', 'ghee', 'vanaspati',
      // Fresh
      'milk', 'toned milk', 'curd', 'dahi', 'yoghurt', 'yogurt', 'paneer', 'butter',
      'cheese', 'egg', 'eggs', 'bread', 'onion', 'potato', 'aloo', 'tomato', 'ginger',
      'garlic', 'lemon', 'coriander', 'dhania', 'palak', 'gobi', 'brinjal', 'bhindi',
      'banana', 'apple', 'mango', 'grapes', 'papaya', 'vegetable', 'sabzi', 'fruit',
      // Packaged
      'biscuit', 'britannia', 'parle', 'maggi', 'noodle', 'namkeen', 'chips',
      'masala', 'turmeric', 'haldi', 'chilli', 'jeera', 'cumin', 'garam masala',
      'pickle', 'achar', 'jam', 'honey', 'cornflakes', 'oats', 'dry fruit', 'cashew',
      'kaju', 'almond', 'badam', 'raisin', 'kishmish', 'soya', 'sauce', 'ketchup',
      'mineral water', 'soft drink', 'juice', 'wafer',
    ],
    weak: ['tea', 'coffee', 'water', 'chocolate', 'ice cream'],
  },
  {
    key: 'category.food',
    shop: [
      'restaurant', 'restro', 'cafe', 'café', 'coffee house', 'swiggy', 'zomato',
      'talabat', 'careem food', 'dominos', "domino's", 'pizza hut', 'mcdonald',
      'kfc', 'subway', 'starbucks', 'barista', 'bakery', 'sweets', 'mithai',
      'dhaba', 'food court', 'kitchen', 'eatery', 'tiffin', 'canteen', 'hotel',
      'bar & grill', 'shawarma', 'रेस्टोरेंट', 'कैफ़े',
    ],
    items: [
      'biryani', 'pizza', 'burger', 'sandwich', 'dosa', 'idli', 'vada', 'uttapam',
      'samosa', 'roti', 'naan', 'kulcha', 'paratha', 'thali', 'curry', 'masala dosa',
      'fried rice', 'manchurian', 'noodles hakka', 'momo', 'kebab', 'kabab', 'tikka',
      'tandoori', 'shawarma', 'falafel', 'hummus', 'biscoff', 'brownie', 'pastry',
      'cappuccino', 'latte', 'espresso', 'americano', 'milkshake', 'lassi', 'faluda',
      'gulab jamun', 'rasgulla', 'halwa', 'service charge', 'table no',
    ],
    weak: ['chai', 'tea', 'coffee', 'dessert', 'ice cream', 'soup', 'salad'],
  },
  {
    key: 'category.health',
    shop: [
      'pharmacy', 'pharma', 'medical', 'medicals', 'chemist', 'druggist', 'hospital',
      'clinic', 'diagnostic', 'pathology', 'apollo', 'medplus', 'wellness forever',
      'netmeds', '1mg', 'dentist', 'dental', 'optical', 'aster', 'medcare',
      'दवा', 'अस्पताल',
    ],
    items: [
      'paracetamol', 'crocin', 'dolo', 'calpol', 'combiflam', 'azithromycin',
      'amoxicillin', 'cetirizine', 'pantoprazole', 'omeprazole', 'metformin',
      'atorvastatin', 'ibuprofen', 'tablet', 'tab.', 'capsule', 'cap.', 'syrup',
      'ointment', 'inhaler', 'insulin', 'injection', 'vaccine', 'bandage', 'gauze',
      'dettol', 'betadine', 'sanitizer', 'thermometer', 'glucometer', 'test strip',
      'vitamin', 'calcium', 'zincovit', 'becosules', 'antacid', 'digene', 'eno',
      'consultation', 'lab test', 'cbc', 'x-ray', 'scan charges',
    ],
    weak: ['mask', 'drops', 'cream', 'gel'],
  },
  {
    key: 'category.personal',
    shop: ['salon', 'spa', 'barber', 'parlour', 'parlor', 'beauty', 'cosmetics', 'nykaa'],
    items: [
      'shampoo', 'conditioner', 'toothpaste', 'colgate', 'closeup', 'toothbrush',
      'deodorant', 'perfume', 'razor', 'gillette', 'shaving', 'after shave',
      'sanitary pad', 'whisper', 'stayfree', 'diaper', 'pampers', 'huggies',
      'face wash', 'hair oil', 'coconut oil', 'body lotion', 'talc', 'powder puff',
      'comb', 'hair cut', 'haircut', 'facial', 'threading', 'waxing', 'pedicure',
      'manicure', 'nail polish', 'lipstick', 'kajal', 'sunscreen',
    ],
    weak: ['soap', 'cream', 'lotion', 'moisturiser', 'moisturizer'],
  },
  {
    key: 'category.household',
    shop: ['hardware', 'plumbing', 'furniture', 'paints', 'sanitary', 'home centre', 'ikea'],
    items: [
      'detergent', 'surf excel', 'ariel', 'tide', 'rin', 'wheel', 'vim', 'pril',
      'dishwash', 'harpic', 'lizol', 'colin', 'phenyl', 'bleach', 'toilet cleaner',
      'floor cleaner', 'broom', 'jhadu', 'mop', 'wiper', 'dustbin', 'garbage bag',
      'trash bag', 'tissue', 'napkin', 'toilet roll', 'aluminium foil', 'cling film',
      'mosquito', 'all out', 'good knight', 'agarbatti', 'incense', 'camphor',
      'candle', 'matchbox', 'match box', 'battery', 'bulb', 'led bulb', 'tube light',
      'extension cord', 'screw', 'nail', 'hinge', 'cement', 'putty',
    ],
    weak: ['brush', 'bucket', 'mug', 'scrub'],
  },
  {
    key: 'category.fuel',
    shop: [
      'petrol', 'diesel', 'fuel', 'indian oil', 'iocl', 'bpcl', 'hpcl', 'nayara',
      'bharat petroleum', 'hindustan petroleum', 'filling station', 'petrol pump',
      'adnoc', 'enoc', 'eppco', 'aramco', 'पेट्रोल', 'डीज़ल',
    ],
    items: ['ms petrol', 'hsd', 'xtrapremium', 'speed petrol', 'cng', 'lpg', 'per litre', 'per ltr'],
  },
  {
    key: 'category.transport',
    shop: [
      'uber', 'ola cabs', 'rapido', 'careem', 'taxi', 'cab ', 'metro rail', 'irctc',
      'railway', 'toll plaza', 'fastag', 'parking', 'rickshaw', 'salik', 'nol card',
      'ऑटो',
    ],
    items: ['trip fare', 'ride fare', 'base fare', 'waiting charge', 'surge', 'toll', 'parking fee'],
  },
  {
    key: 'category.travel',
    shop: [
      'airlines', 'indigo', 'spicejet', 'air india', 'akasa', 'emirates', 'etihad',
      'flydubai', 'makemytrip', 'goibibo', 'cleartrip', 'booking.com', 'agoda',
      'oyo', 'resort', 'tourism', 'travels', 'airport',
    ],
    items: ['boarding pass', 'pnr', 'baggage', 'check-in', 'room charge', 'room rent', 'tariff'],
  },
  {
    key: 'category.entertainment',
    shop: [
      'cinema', 'cinemas', 'pvr', 'inox', 'multiplex', 'bookmyshow', 'netflix',
      'spotify', 'prime video', 'hotstar', 'vox cinemas', 'reel cinemas',
      'amusement', 'game zone',
    ],
    items: ['ticket', 'popcorn', 'screen no', 'seat no', 'show time', 'subscription'],
  },
  {
    key: 'category.phone',
    shop: ['airtel', 'jio', 'vodafone', 'vi ', 'bsnl', 'etisalat', 'du ', 'jazz', 'zong', 'ufone'],
    items: ['recharge', 'prepaid', 'postpaid', 'data pack', 'talktime', 'validity'],
  },
  {
    key: 'category.utilities',
    shop: [
      'electricity', 'water bill', 'gas bill', 'broadband', 'bescom', 'bses',
      'power corporation', 'dewa', 'sewa', 'addc', 'k-electric', 'wapda',
    ],
    items: ['units consumed', 'meter reading', 'kwh', 'sanctioned load', 'bill period'],
  },
  {
    key: 'category.education',
    shop: [
      'school', 'college', 'tuition', 'academy', 'stationery', 'book store',
      'bookstore', 'institute', 'university', 'coaching',
    ],
    items: [
      'notebook', 'note book', 'register', 'exercise book', 'textbook', 'text book',
      'pencil', 'eraser', 'sharpener', 'geometry box', 'chart paper', 'glue stick',
      'crayons', 'sketch pen', 'school fee', 'tuition fee', 'admission fee',
      'exam fee', 'stapler',
    ],
    weak: ['pen', 'file', 'folder', 'marker', 'scale'],
  },
  {
    key: 'category.shopping',
    shop: [
      'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'noon', 'namshi', 'shein',
      'apparel', 'garment', 'footwear', 'fashion', 'lifestyle', 'westside',
      'pantaloons', 'max fashion', 'centrepoint', 'brand factory', 'textiles',
      'saree', 'boutique', 'readymade', 'bata', 'nike', 'adidas', 'decathlon',
      'croma', 'reliance digital', 'vijay sales', 'sharaf dg', 'jumbo electronics',
      'electronics', 'mobile store',
    ],
    items: [
      't-shirt', 'tshirt', 't shirt', 'shirt', 'trouser', 'jeans', 'kurta', 'kurti',
      'salwar', 'lehenga', 'dupatta', 'blouse', 'frock', 'dress', 'skirt', 'jacket',
      'sweater', 'shoe', 'shoes', 'sandal', 'slipper', 'chappal', 'sneaker', 'socks',
      'innerwear', 'vest', 'brief', 'handbag', 'wallet', 'belt', 'watch strap',
      // Gadgets and accessories. Not a category of their own in this app, and
      // Shopping is where someone looking for a phone charger would look.
      'usb cable', 'power bank', 'charger', 'earphone', 'headphone', 'earbuds',
      'mobile cover', 'screen guard', 'memory card', 'pen drive', 'keyboard',
      'laptop bag', 'smart watch',
    ],
    weak: ['bag', 'cap', 'towel', 'bedsheet'],
  },
];

/* ------------------------------------------------------- the item region */

/** A row that ends the item list — everything below is totals and legalese. */
const TOTALS_ROW =
  /(sub\s*-?\s*total|grand\s*total|net\s*(amount|payable|total)|total\s*(amount|payable|qty)?|amount\s*(due|payable)|bill\s*amount)\b/i;

/**
 * A row that is never an item: the shop's own paperwork and pleasantries.
 * These carry the words most likely to mislead — a grocery bill printed by a
 * company whose registered name contains "Restaurant", a chemist whose footer
 * advertises a sister hotel.
 */
const NOT_AN_ITEM =
  /gstin|gst\s*no|tin\s*:|fssai|cin\s*:|licence|license|thank\s*you|visit\s*again|come\s*again|welcome|terms|conditions|no\s*exchange|no\s*refund|goods\s*once\s*sold|customer\s*care|helpline|www\.|https?:|@|phone|tel\b|mob\b|contact|invoice\s*no|bill\s*no|cashier|counter|date\b|time\b|token|table\s*no|^-+$|^=+$|^\*+$/i;

/**
 * The rows that list what was bought.
 *
 * Starts below the masthead — the top few rows are the shop's name and address,
 * and whatever is up there is shop evidence, not item evidence. Ends at the
 * first totals row, because everything after it is arithmetic.
 *
 * When there is no totals row to find (a short slip, a bad scan) the whole
 * body is used. Losing the boundary costs a little precision; refusing to look
 * costs the entire feature.
 */
export function itemRegion(rows: string[]): string[] {
  if (rows.length === 0) return [];

  // A masthead is at most the first three rows, and never more than a third of
  // a short receipt — on a five-row slip, skipping three would leave nothing.
  const mastheadRows = Math.min(3, Math.floor(rows.length / 3));

  const totalsAt = rows.findIndex((r, i) => i >= mastheadRows && TOTALS_ROW.test(r));
  const end = totalsAt === -1 ? rows.length : totalsAt;

  return rows.slice(mastheadRows, end).filter((r) => !NOT_AN_ITEM.test(r));
}

/** The rows that identify the business: the masthead, plus the merchant name. */
export function shopRegion(rows: string[], merchant: string | null): string[] {
  const masthead = rows.slice(0, Math.min(4, rows.length));
  return merchant ? [merchant, ...masthead] : masthead;
}

/* ------------------------------------------------------------- the guess */

export interface CategoryGuess {
  /** A seeded category key such as `category.groceries`, or null. */
  key: string | null;
  /**
   * Enough to fill the field in unasked?
   *  'shop'  — the business named itself. Strongest.
   *  'items' — several goods agreed. Strong enough.
   *  null    — say nothing.
   */
  from: 'shop' | 'items' | null;
  /** The words it matched on, best first, for showing the user. */
  evidence: string[];
  score: number;
}

const NOTHING: CategoryGuess = { key: null, from: null, evidence: [], score: 0 };

function normalise(rows: string[]): string {
  return ` ${rows.join(' \n ').toLowerCase().replace(/\s+/g, ' ')} `;
}

/**
 * Read the bill and decide what it was for.
 *
 * Scores every category, then requires the winner to clear `MIN_SCORE` **and**
 * to beat the runner-up outright. A tie is not a decision, and a bill that
 * genuinely looks like two things is exactly the bill a person should classify
 * themselves.
 */
export function guessCategory(rows: string[], merchant: string | null = null): CategoryGuess {
  if (rows.length === 0) return NOTHING;

  const shopText = normalise(shopRegion(rows, merchant));
  const itemText = normalise(itemRegion(rows));

  const scored = LEXICON.map((entry) => {
    const hits: { term: string; weight: number; shop: boolean }[] = [];

    for (const term of entry.shop ?? []) {
      if (shopText.includes(term.toLowerCase())) {
        hits.push({ term, weight: SHOP_WEIGHT, shop: true });
      }
    }
    // Shop words also count when they appear among the items — a line reading
    // "PHARMACY CHARGES" is evidence — but only at item strength.
    for (const term of entry.shop ?? []) {
      if (!shopText.includes(term.toLowerCase()) && itemText.includes(term.toLowerCase())) {
        hits.push({ term, weight: ITEM_WEIGHT, shop: false });
      }
    }
    for (const term of entry.items ?? []) {
      if (itemText.includes(term.toLowerCase())) {
        hits.push({ term, weight: ITEM_WEIGHT, shop: false });
      }
    }
    for (const term of entry.weak ?? []) {
      if (itemText.includes(term.toLowerCase())) {
        hits.push({ term, weight: WEAK_WEIGHT, shop: false });
      }
    }

    // Longest terms first: "mustard oil" is more interesting evidence than
    // "oil", and it is what a person wants to see quoted back at them.
    hits.sort((a, b) => b.weight - a.weight || b.term.length - a.term.length);

    return {
      key: entry.key,
      score: hits.reduce((sum, h) => sum + h.weight, 0),
      fromShop: hits.some((h) => h.shop),
      evidence: hits.map((h) => h.term),
    };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (!winner || winner.score < MIN_SCORE) return NOTHING;

  const runnerUp = scored[1];
  if (runnerUp && runnerUp.score >= winner.score) return NOTHING;

  return {
    key: winner.key,
    from: winner.fromShop ? 'shop' : 'items',
    // Four is as many as a person will read off a confirmation screen.
    evidence: winner.evidence.slice(0, 4),
    score: winner.score,
  };
}

/** Exported for tests and for anyone widening the vocabulary. */
export { LEXICON, MIN_SCORE };
