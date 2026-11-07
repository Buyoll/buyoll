// 100 Buyoll Bundle Deals Promotional Messages
// Grouped into 10 categories, cycled 1 message per 3-day window

export interface PromoMessage {
  category: string;
  text: string;
}

export const PROMO_MESSAGES: PromoMessage[] = [
  // 🔥 Buy More, Save More (1 - 10)
  { category: 'Buy More, Save More', text: 'Buy More, Save More! Bundle Deal Is ON!' },
  { category: 'Buy More, Save More', text: 'Why Buy 1 When You Can Get 3 For Less?' },
  { category: 'Buy More, Save More', text: '2 For The Price Of 1 – Today Only!' },
  { category: 'Buy More, Save More', text: 'Buy 2 Get 1 FREE – Bundle Deal!' },
  { category: 'Buy More, Save More', text: 'Buy 3 Get 1 FREE – Don’t Miss Out!' },
  { category: 'Buy More, Save More', text: 'More Items, Less Money – Bundle Up!' },
  { category: 'Buy More, Save More', text: 'The More You Buy, The More You Save!' },
  { category: 'Buy More, Save More', text: 'Smart Shoppers Buy Bundles!' },
  { category: 'Buy More, Save More', text: 'One Price, More Value!' },
  { category: 'Buy More, Save More', text: 'Bundle Up & Save Big Today!' },

  // 💰 Price & Discount Focus (11 - 20)
  { category: 'Price & Discount Focus', text: '3 Items, 1 Amazing Price!' },
  { category: 'Price & Discount Focus', text: 'Save Up To 50% With Our Bundle!' },
  { category: 'Price & Discount Focus', text: 'Mega Bundle, Mega Savings!' },
  { category: 'Price & Discount Focus', text: 'Huge Discount On All Bundles Today!' },
  { category: 'Price & Discount Focus', text: 'Get The Full Set For Less!' },
  { category: 'Price & Discount Focus', text: 'Bundle Price – Too Good To Miss!' },
  { category: 'Price & Discount Focus', text: 'Pay Less, Get More!' },
  { category: 'Price & Discount Focus', text: 'Unbeatable Bundle Price!' },
  { category: 'Price & Discount Focus', text: 'Small Price, Big Bundle!' },
  { category: 'Price & Discount Focus', text: 'Your Wallet Will Love This Bundle!' },

  // 🛒 Combo / Mix & Match (21 - 30)
  { category: 'Combo / Mix & Match', text: 'Mix, Match & Save – Bundle Deal!' },
  { category: 'Combo / Mix & Match', text: 'Create Your Own Bundle & Save!' },
  { category: 'Combo / Mix & Match', text: 'Combo Offer – Save Up To 40%!' },
  { category: 'Combo / Mix & Match', text: 'Pick Any 3, Pay For 2!' },
  { category: 'Combo / Mix & Match', text: 'Pick Any 2, Get 20% OFF!' },
  { category: 'Combo / Mix & Match', text: 'Bundle Your Favourites & Save!' },
  { category: 'Combo / Mix & Match', text: 'Mix & Match Bundle – You Choose!' },
  { category: 'Combo / Mix & Match', text: 'Your Favourite Items, One Low Price!' },
  { category: 'Combo / Mix & Match', text: 'Combine & Save – Bundle Live Now!' },
  { category: 'Combo / Mix & Match', text: 'Build Your Bundle, Save Your Cash!' },

  // ✨ New / Trending (31 - 40)
  { category: 'New / Trending', text: 'New Bundle Just Dropped!' },
  { category: 'New / Trending', text: 'Trending Bundle – Everyone Is Buying It!' },
  { category: 'New / Trending', text: 'Hot Bundle Alert – Selling Fast!' },
  { category: 'New / Trending', text: 'Fresh Stock, Fresh Bundle Deal!' },
  { category: 'New / Trending', text: 'Just In: Our Best Bundle Ever!' },
  { category: 'New / Trending', text: 'Customer Favourite Bundle Is Back!' },
  { category: 'New / Trending', text: 'Most Wanted Bundle – Back In Stock!' },
  { category: 'New / Trending', text: 'The Bundle Everyone Is Talking About!' },
  { category: 'New / Trending', text: 'Viral Bundle Deal – Grab Yours!' },
  { category: 'New / Trending', text: 'New Season, New Bundle, New Price!' },

  // ⏰ Urgency / Limited Stock (41 - 50)
  { category: 'Urgency / Limited Stock', text: 'Limited Bundle Offer – Hurry!' },
  { category: 'Urgency / Limited Stock', text: 'Bundle Deal Ends Tonight!' },
  { category: 'Urgency / Limited Stock', text: 'Only Today – Bundle Price!' },
  { category: 'Urgency / Limited Stock', text: 'Weekend Only Bundle – Don’t Sleep On It!' },
  { category: 'Urgency / Limited Stock', text: 'FLASH SALE – Bundle Deal Live!' },
  { category: 'Urgency / Limited Stock', text: 'Only 10 Bundles Left!' },
  { category: 'Urgency / Limited Stock', text: 'While Stock Lasts – Bundle Now!' },
  { category: 'Urgency / Limited Stock', text: 'Last Chance – Bundle Closing Soon!' },
  { category: 'Urgency / Limited Stock', text: 'First 20 Buyers Get Extra Gift!' },
  { category: 'Urgency / Limited Stock', text: 'Tick Tock… Bundle Almost Gone!' },

  // 🎁 Gift / Value (51 - 60)
  { category: 'Gift / Value', text: 'Perfect Gift Bundle – Ready To Go!' },
  { category: 'Gift / Value', text: 'Gift Bundle – Save Time, Save Money!' },
  { category: 'Gift / Value', text: 'One Bundle, Endless Happiness!' },
  { category: 'Gift / Value', text: 'Treat Yourself – Bundle Deal!' },
  { category: 'Gift / Value', text: 'Treat Someone You Love – Bundle Gift!' },
  { category: 'Gift / Value', text: 'Double The Value, Half The Price!' },
  { category: 'Gift / Value', text: 'Get More Value For Your Money!' },
  { category: 'Gift / Value', text: 'Value Bundle – Best Deal In Town!' },
  { category: 'Gift / Value', text: 'Full Package, Full Value!' },
  { category: 'Gift / Value', text: 'Everything You Need In One Bundle!' },

  // 🏠 Home / Daily Essentials (61 - 70)
  { category: 'Home / Daily Essentials', text: 'Home Essentials Bundle – Stock Up & Save!' },
  { category: 'Home / Daily Essentials', text: 'Daily Needs Bundle – One Price!' },
  { category: 'Home / Daily Essentials', text: 'Kitchen Bundle – All You Need!' },
  { category: 'Home / Daily Essentials', text: 'Cleaning Bundle – Save Big Today!' },
  { category: 'Home / Daily Essentials', text: 'Family Essentials Bundle – Pay Less!' },
  { category: 'Home / Daily Essentials', text: 'Stock Up Bundle – Save For The Month!' },
  { category: 'Home / Daily Essentials', text: 'Home Care Bundle – Best Price Ever!' },
  { category: 'Home / Daily Essentials', text: 'Everyday Bundle For Everyday Savings!' },
  { category: 'Home / Daily Essentials', text: 'Household Bundle – One Box, Big Savings!' },
  { category: 'Home / Daily Essentials', text: 'Essentials Bundle – Sorted For You!' },

  // 👗 Fashion / Beauty / Lifestyle (71 - 80)
  { category: 'Fashion / Beauty / Lifestyle', text: 'Outfit Bundle – Top + Bottom = Save!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Fashion Bundle – 3 Pieces, 1 Price!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Look Rich, Pay Less – Bundle Deal!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Glow Bundle – Beauty For Less!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Complete Look Bundle – Shop Now!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Style Bundle – Dress Up For Less!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Beauty Combo – Save Big Today!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Fashion Lovers, This Bundle Is For You!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Buy The Look – Bundle Price!' },
  { category: 'Fashion / Beauty / Lifestyle', text: 'Wardrobe Refresh Bundle – Shop Now!' },

  // 📦 Delivery / Shopping Experience (81 - 90)
  { category: 'Delivery / Shopping Experience', text: 'Free Delivery On All Bundles Today!' },
  { category: 'Delivery / Shopping Experience', text: 'Order Bundle Now, Delivered Fast!' },
  { category: 'Delivery / Shopping Experience', text: 'Bundle + Free Delivery = Perfect Deal!' },
  { category: 'Delivery / Shopping Experience', text: 'Shop From Home – Bundle Delivered To You!' },
  { category: 'Delivery / Shopping Experience', text: 'Easy Order, Big Savings – Bundle!' },
  { category: 'Delivery / Shopping Experience', text: 'Cash On Delivery Available On Bundles!' },
  { category: 'Delivery / Shopping Experience', text: 'Order Today, Receive Tomorrow!' },
  { category: 'Delivery / Shopping Experience', text: 'Bundle Deal + Fast Delivery!' },
  { category: 'Delivery / Shopping Experience', text: 'Shop Smart, Save More – Order Now!' },
  { category: 'Delivery / Shopping Experience', text: 'One Click, One Bundle, Big Savings!' },

  // ❤️ Fun & Catchy (91 - 100)
  { category: 'Fun & Catchy', text: 'Bundle It Like It’s Hot!' },
  { category: 'Fun & Catchy', text: 'Why Settle For One?' },
  { category: 'Fun & Catchy', text: 'Bundle Lovers, This One’s For You!' },
  { category: 'Fun & Catchy', text: 'Bundle Up & Level Up!' },
  { category: 'Fun & Catchy', text: 'More Is More – Bundle Deal!' },
  { category: 'Fun & Catchy', text: 'The Bundle That Makes Sense!' },
  { category: 'Fun & Catchy', text: 'Save Smart, Shop Bundles!' },
  { category: 'Fun & Catchy', text: 'Don’t Buy Single, Buy Bundle!' },
  { category: 'Fun & Catchy', text: 'Bundle Madness Is Here!' },
  { category: 'Fun & Catchy', text: 'Best Bundle Ever – Grab It Now!' },
];
