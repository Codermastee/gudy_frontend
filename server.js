const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const { eq, desc } = require('drizzle-orm');
const { users, orders, cartItems } = require('./schema');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'gudy_secret_change_in_production';

// ==================== DATABASE & MIDDLEWARE ====================

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

app.use(cors());
app.use(express.json());

// ==================== RESEND SETUP ====================

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendOrderNotification(order) {
  const itemsHTML = order.items.map(item => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #f0e0cc;">${item.name}</td>
      <td style="padding:10px;border-bottom:1px solid #f0e0cc;">${item.weight}</td>
      <td style="padding:10px;border-bottom:1px solid #f0e0cc;">x${item.quantity}</td>
      <td style="padding:10px;border-bottom:1px solid #f0e0cc;font-weight:600;">₹${item.priceINR * item.quantity}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #f0e0cc;border-radius:12px;overflow:hidden;">

      <div style="background:linear-gradient(135deg,#2C1A0E,#6B4423);padding:28px;text-align:center;">
        <h1 style="color:#FF9500;margin:0;font-size:24px;">🛒 New Order Received!</h1>
        <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">GUDY Organics Admin Notification</p>
      </div>

      <div style="padding:28px;background:#fff;">

        <h2 style="color:#6B4423;font-size:16px;margin-bottom:12px;">👤 Customer Details</h2>
        <table style="width:100%;background:#FDF6EE;border-radius:8px;padding:16px;margin-bottom:24px;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 12px;color:#7A6455;width:140px;">Name</td>
            <td style="padding:6px 12px;font-weight:600;">${order.shippingAddress.fullName}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;color:#7A6455;">Phone</td>
            <td style="padding:6px 12px;font-weight:600;">${order.shippingAddress.phone}</td>
          </tr>
          <tr>
            <td style="padding:6px 12px;color:#7A6455;">Payment</td>
            <td style="padding:6px 12px;font-weight:600;text-transform:uppercase;">${order.paymentMethod}</td>
          </tr>
        </table>

        <h2 style="color:#6B4423;font-size:16px;margin-bottom:12px;">📦 Shipping Address</h2>
        <div style="background:#FDF6EE;border-radius:8px;padding:16px;margin-bottom:24px;line-height:1.8;color:#2C1810;">
          ${order.shippingAddress.address},<br/>
          ${order.shippingAddress.city}, ${order.shippingAddress.state} – ${order.shippingAddress.pincode}
        </div>

        <h2 style="color:#6B4423;font-size:16px;margin-bottom:12px;">🛍️ Items Ordered</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr style="background:#6B4423;color:white;">
              <th style="padding:10px;text-align:left;">Product</th>
              <th style="padding:10px;text-align:left;">Weight</th>
              <th style="padding:10px;text-align:left;">Qty</th>
              <th style="padding:10px;text-align:left;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHTML}</tbody>
        </table>

        <div style="background:linear-gradient(135deg,#2C1A0E,#6B4423);border-radius:8px;padding:20px;text-align:right;color:white;">
          <span style="font-size:14px;opacity:0.8;">Total Amount</span><br/>
          <span style="font-size:32px;font-weight:900;color:#FF9500;">₹${order.totalAmount}</span>
        </div>

      </div>

      <div style="background:#FDF6EE;padding:16px;text-align:center;">
        <p style="color:#9A8070;font-size:12px;margin:0;">© ${new Date().getFullYear()} GUDY Organics · office.gudy@gmail.com</p>
      </div>
    </div>
  `;

  await resend.emails.send({
    from: 'GUDY Orders <onboarding@resend.dev>',
    to: process.env.ADMIN_EMAIL,
    subject: `🛒 New Order – ₹${order.totalAmount} from ${order.shippingAddress.fullName}`,
    html,
  });
}

// ==================== CUSTOMER ORDER CONFIRMATION EMAIL ====================

async function sendOrderConfirmationToCustomer(order, customerEmail) {
  const itemsHTML = order.items.map(item => `
    <tr>
      <td style="padding:12px 10px;border-bottom:1px solid #f0e0cc;color:#2C1810;">${item.name}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #f0e0cc;color:#2C1810;">${item.weight}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #f0e0cc;text-align:center;color:#2C1810;">x${item.quantity}</td>
      <td style="padding:12px 10px;border-bottom:1px solid #f0e0cc;font-weight:700;color:#6B4423;">₹${item.priceINR * item.quantity}</td>
    </tr>
  `).join('');

  const paymentLabel = order.paymentMethod === 'cod'
    ? '💵 Cash on Delivery'
    : '💳 Online Payment';

  const estimatedDelivery = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"/></head>
    <body style="margin:0;padding:0;background:#FFF8F0;font-family:Arial,sans-serif;">

      <div style="max-width:600px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(107,68,35,0.10);border:1px solid #f0e0cc;">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,#2C1A0E 0%,#6B4423 100%);padding:36px 28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:8px;">🎉</div>
          <h1 style="color:#FF9500;margin:0 0 6px;font-size:26px;letter-spacing:0.5px;">Order Confirmed!</h1>
          <p style="color:rgba(255,255,255,0.85);margin:0;font-size:15px;">Thank you for shopping with GUDY Organics</p>
        </div>

        <!-- Order ID Banner -->
        <div style="background:#FFF3E0;padding:14px 28px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f0e0cc;">
          <span style="color:#7A6455;font-size:13px;">Order ID</span>
          <span style="color:#6B4423;font-weight:700;font-size:15px;">#GUDY-${String(order.id).padStart(5,'0')}</span>
        </div>

        <div style="padding:28px;">

          <!-- Greeting -->
          <p style="color:#2C1810;font-size:15px;margin:0 0 24px;">
            Hi <strong>${order.shippingAddress.fullName}</strong>, your order has been successfully placed! 
            We'll notify you once it's shipped. 🚚
          </p>

          <!-- Order Items -->
          <h2 style="color:#6B4423;font-size:15px;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #f0e0cc;">🛍️ Items Ordered</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <thead>
              <tr style="background:#6B4423;">
                <th style="padding:10px;text-align:left;color:#fff;font-size:13px;border-radius:4px 0 0 0;">Product</th>
                <th style="padding:10px;text-align:left;color:#fff;font-size:13px;">Weight</th>
                <th style="padding:10px;text-align:center;color:#fff;font-size:13px;">Qty</th>
                <th style="padding:10px;text-align:left;color:#fff;font-size:13px;border-radius:0 4px 0 0;">Price</th>
              </tr>
            </thead>
            <tbody>${itemsHTML}</tbody>
          </table>

          <!-- Total -->
          <div style="background:linear-gradient(135deg,#2C1A0E,#6B4423);border-radius:10px;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
            <span style="color:rgba(255,255,255,0.8);font-size:14px;">Total Amount</span>
            <span style="color:#FF9500;font-size:28px;font-weight:900;">₹${order.totalAmount}</span>
          </div>

          <!-- Two Columns: Shipping + Payment -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="width:50%;vertical-align:top;padding-right:10px;">
                <div style="background:#FDF6EE;border-radius:10px;padding:16px;">
                  <h3 style="color:#6B4423;font-size:13px;margin:0 0 10px;">📦 Shipping To</h3>
                  <p style="color:#2C1810;font-size:13px;margin:0;line-height:1.7;">
                    <strong>${order.shippingAddress.fullName}</strong><br/>
                    ${order.shippingAddress.address},<br/>
                    ${order.shippingAddress.city}, ${order.shippingAddress.state}<br/>
                    Pincode: ${order.shippingAddress.pincode}<br/>
                    📞 ${order.shippingAddress.phone}
                  </p>
                </div>
              </td>
              <td style="width:50%;vertical-align:top;padding-left:10px;">
                <div style="background:#FDF6EE;border-radius:10px;padding:16px;">
                  <h3 style="color:#6B4423;font-size:13px;margin:0 0 10px;">💳 Payment Info</h3>
                  <p style="color:#2C1810;font-size:13px;margin:0;line-height:1.7;">
                    <strong>${paymentLabel}</strong><br/><br/>
                    <span style="color:#7A6455;">Est. Delivery by</span><br/>
                    <strong>${estimatedDelivery}</strong>
                  </p>
                </div>
              </td>
            </tr>
          </table>

          <!-- What's Next -->
          <div style="background:#F0FFF4;border:1px solid #B7EBC9;border-radius:10px;padding:16px;margin-bottom:24px;">
            <h3 style="color:#276749;font-size:13px;margin:0 0 10px;">✅ What happens next?</h3>
            <ol style="color:#2C1810;font-size:13px;margin:0;padding-left:18px;line-height:2;">
              <li>We'll verify and process your order within 24 hours</li>
              <li>Your order will be packed with care</li>
              <li>You'll receive tracking details once shipped</li>
              <li>Estimated delivery in 3–7 business days</li>
            </ol>
          </div>

          <!-- Track Your Order -->
          <div style="background:linear-gradient(135deg,#FFF8F0,#FDF0E0);border:2px solid #F0A500;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
            <h3 style="color:#6B4423;font-size:15px;margin:0 0 6px;">📦 Track Your Order</h3>
            <p style="color:#7A6455;font-size:13px;margin:0 0 14px;">Use the Order ID below to track your shipment status</p>
            <div style="display:inline-block;background:#fff;border:2px dashed #F0A500;border-radius:8px;padding:10px 28px;margin-bottom:14px;">
              <span style="color:#6B4423;font-size:22px;font-weight:900;letter-spacing:2px;">#GUDY-${String(order.id).padStart(5,'0')}</span>
            </div>
            <p style="color:#7A6455;font-size:12px;margin:0;">
              You can quote this ID when contacting us about your order status.<br/>
              We'll also send you tracking details via email once your order is shipped. 🚚
            </p>
          </div>

          <!-- Need Help -->
          <div style="text-align:center;padding:16px;background:#FDF6EE;border-radius:10px;">
            <p style="color:#7A6455;font-size:13px;margin:0 0 8px;">Need help with your order?</p>
            <a href="mailto:office.gudy@gmail.com" style="color:#6B4423;font-weight:700;font-size:13px;text-decoration:none;">📧 office.gudy@gmail.com</a>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            <a href="tel:+919876543210" style="color:#6B4423;font-weight:700;font-size:13px;text-decoration:none;">📞 +91 9876543210</a>
          </div>

        </div>

        <!-- Footer -->
        <div style="background:#2C1A0E;padding:20px;text-align:center;">
          <p style="color:#FF9500;font-size:14px;font-weight:700;margin:0 0 4px;">GUDY Organics</p>
          <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:0;">Premium Jaggery | 100% Organic | Chemical Free</p>
          <p style="color:rgba(255,255,255,0.3);font-size:10px;margin:8px 0 0;">© ${new Date().getFullYear()} GUDY Organics. All rights reserved.</p>
        </div>

      </div>
    </body>
    </html>
  `;

  await resend.emails.send({
    from: 'GUDY Organics <onboarding@resend.dev>',
    to: customerEmail,
    subject: `✅ Order Confirmed #GUDY-${String(order.id).padStart(5,'0')} – ₹${order.totalAmount}`,
    html,
  });
}

// ── Optional auth — sets req.user if valid token present, allows guests through ──
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded; // { id, email, name }
    }
  } catch { /* invalid/expired token — treat as guest */ }
  next();
};

// ── Require auth — rejects unauthenticated requests ──
const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// ==================== EXPANDED MULTI-LANGUAGE SUPPORT ====================

const translations = {
  // ENGLISH
  en: {
    greeting: "Hello! 👋 Welcome to GUDY! I'm here to help you with our premium jaggery products. How can I assist you today?",
    contact: {
      phone: '+91 9876543210',
      email: 'support@gudy.com',
      whatsapp: '+91 9876543210',
      hours: 'Monday to Saturday, 9 AM - 6 PM'
    },
    faqs: {
      shipping: 'We offer FREE shipping on all orders above ₹299. For orders below ₹299, standard shipping charges of ₹40 apply.',
      delivery: 'Delivery typically takes 3-7 business days depending on your location. Metro cities receive orders within 3-4 days.',
      cod: 'Yes! We accept Cash on Delivery (COD) for all orders. You can also pay online using UPI, cards, or net banking.',
      returns: 'We have a 7-day return policy. If you receive a damaged or defective product, contact us within 7 days for a replacement or refund.',
      storage: 'Store in a cool, dry place in an airtight container. Keep away from moisture to prevent hardening.',
      expiry: 'Our jaggery products have a shelf life of 12 months from the date of manufacturing when stored properly.',
      organic: 'Yes, our jaggery is made from 100% organic sugarcane grown without pesticides or chemicals.',
      bulk: 'Yes! For bulk orders above 50kg, please contact us for special pricing. WhatsApp: +91 9876543210'
    }
  },
  
  // HINDI - हिंदी
  hi: {
    greeting: "नमस्ते! 👋 GUDY में आपका स्वागत है! मैं यहाँ आपकी प्रीमियम गुड़ उत्पादों में सहायता के लिए हूँ। मैं आपकी कैसे मदद कर सकता हूँ?",
    contact: {
      phone: '+91 9876543210',
      email: 'support@gudy.com',
      whatsapp: '+91 9876543210',
      hours: 'सोमवार से शनिवार, सुबह 9 बजे - शाम 6 बजे'
    },
    faqs: {
      shipping: '₹299 से अधिक के सभी ऑर्डर पर मुफ्त शिपिंग। ₹299 से कम के ऑर्डर पर ₹40 शिपिंग शुल्क लागू होता है।',
      delivery: 'डिलीवरी में आमतौर पर आपके स्थान के आधार पर 3-7 व्यावसायिक दिन लगते हैं। मेट्रो शहरों में 3-4 दिनों में ऑर्डर मिलता है।',
      cod: 'हां! हम सभी ऑर्डर के लिए कैश ऑन डिलीवरी (COD) स्वीकार करते हैं। आप UPI, कार्ड या नेट बैंकिंग का उपयोग करके ऑनलाइन भी भुगतान कर सकते हैं।',
      returns: 'हमारे पास 7 दिन की रिटर्न पॉलिसी है। यदि आपको क्षतिग्रस्त या दोषपूर्ण उत्पाद मिलता है, तो प्रतिस्थापन या रिफंड के लिए 7 दिनों के भीतर हमसे संपर्क करें।',
      storage: 'एयरटाइट कंटेनर में ठंडी, सूखी जगह पर स्टोर करें। सख्त होने से रोकने के लिए नमी से दूर रखें।',
      expiry: 'हमारे गुड़ उत्पादों की शेल्फ लाइफ निर्माण की तारीख से 12 महीने है जब उचित रूप से संग्रहीत किया जाता है।',
      organic: 'हां, हमारा गुड़ 100% जैविक गन्ने से बनाया जाता है जो बिना कीटनाशकों या रसायनों के उगाया जाता है।',
      bulk: 'हां! 50 किलो से अधिक के थोक ऑर्डर के लिए, विशेष मूल्य निर्धारण के लिए कृपया हमसे संपर्क करें। WhatsApp: +91 9876543210'
    }
  },
  
  // TAMIL - தமிழ்
  ta: {
    greeting: "வணக்கம்! 👋 GUDY-க்கு வரவேற்கிறோம்! எங்கள் பிரீமியம் வெல்லம் பொருட்களில் உங்களுக்கு உதவ நான் இங்கே இருக்கிறேன். நான் எப்படி உதவ முடியும்?",
    contact: {
      phone: '+91 9876543210',
      email: 'support@gudy.com',
      whatsapp: '+91 9876543210',
      hours: 'திங்கள் முதல் சனி, காலை 9 மணி - மாலை 6 மணி'
    },
    faqs: {
      shipping: '₹299 க்கு மேல் அனைத்து ஆர்டர்களுக்கும் இலவச ஷிப்பிங். ₹299 க்கு குறைவான ஆர்டர்களுக்கு ₹40 ஷிப்பிங் கட்டணம் பொருந்தும்.',
      delivery: 'உங்கள் இடத்தைப் பொறுத்து பொதுவாக டெலிவரிக்கு 3-7 வணிக நாட்கள் ஆகும். மெட்ரோ நகரங்கள் 3-4 நாட்களில் ஆர்டர்களைப் பெறுகின்றன.',
      cod: 'ஆம்! அனைத்து ஆர்டர்களுக்கும் கேஷ் ஆன் டெலிவரி (COD) ஏற்றுக்கொள்கிறோம். UPI, கார்டுகள் அல்லது நெட் பேங்கிங் பயன்படுத்தி ஆன்லைனில் பணம் செலுத்தலாம்.',
      returns: 'எங்களிடம் 7 நாள் திரும்பப் பெறும் கொள்கை உள்ளது. சேதமடைந்த அல்லது குறைபாடுள்ள தயாரிப்பு கிடைத்தால், மாற்று அல்லது பணத்திருப்பிக்கு 7 நாட்களுக்குள் எங்களைத் தொடர்பு கொள்ளவும்.',
      storage: 'காற்று புகாத கொள்கலனில் குளிர்ந்த, வறண்ட இடத்தில் சேமிக்கவும். கடினமாவதைத் தடுக்க ஈரப்பதத்திலிருந்து விலகி வைக்கவும்.',
      expiry: 'எங்கள் வெல்லம் பொருட்கள் சரியாக சேமித்தால் உற்பத்தி தேதியிலிருந்து 12 மாதங்கள் ஆயுட்காலம் உள்ளன.',
      organic: 'ஆம், எங்கள் வெல்லம் 100% இயற்கை கரும்பில் இருந்து தயாரிக்கப்படுகிறது, இது பூச்சிக்கொல்லிகள் அல்லது இரசாயனங்கள் இல்லாமல் வளர்க்கப்படுகிறது.',
      bulk: 'ஆம்! 50 கிலோவுக்கு மேல் மொத்த ஆர்டர்களுக்கு, சிறப்பு விலைக்கு எங்களை தொடர்பு கொள்ளவும். WhatsApp: +91 9876543210'
    }
  },
  
  // TELUGU - తెలుగు
  te: {
    greeting: "నమస్కారం! 👋 GUDY కు స్వాగతం! మా ప్రీమియం బెల్లం ఉత్పత్తులలో మీకు సహాయం చేయడానికి నేను ఇక్కడ ఉన్నాను. నేను ఎలా సహాయం చేయగలను?",
    contact: {
      phone: '+91 9876543210',
      email: 'support@gudy.com',
      whatsapp: '+91 9876543210',
      hours: 'సోమవారం నుండి శనివారం, ఉదయం 9 గంటలు - సాయంత్రం 6 గంటలు'
    },
    faqs: {
      shipping: '₹299 కంటే ఎక్కువ అన్ని ఆర్డర్లకు ఉచిత షిప్పింగ్. ₹299 కంటే తక్కువ ఆర్డర్లకు ₹40 షిప్పింగ్ ఛార్జీలు వర్తిస్తాయి.',
      delivery: 'మీ స్థానాన్ని బట్టి డెలివరీకి సాధారణంగా 3-7 వ్యాపార దినాలు పడుతుంది. మెట్రో నగరాలు 3-4 రోజుల్లో ఆర్డర్లను అందుకుంటాయి.',
      cod: 'అవును! అన్ని ఆర్డర్లకు క్యాష్ ఆన్ డెలివరీ (COD) అంగీకరిస్తాము. UPI, కార్డులు లేదా నెట్ బ్యాంకింగ్ ఉపయోగించి ఆన్లైన్లో కూడా చెల్లించవచ్చు.',
      returns: 'మాకు 7 రోజుల రిటర్న్ పాలసీ ఉంది. మీకు దెబ్బతిన్న లేదా లోపభూయిష్ట ఉత్పత్తి లభించినట్లయితే, రీప్లేస్మెంట్ లేదా రీఫండ్ కోసం 7 రోజుల్లో మమ్మల్ని సంప్రదించండి.',
      storage: 'గాలి చొరబడని కంటైనర్లో చల్లని, పొడి ప్రదేశంలో నిల్వ చేయండి. గట్టిపడకుండా తేమ నుండి దూరంగా ఉంచండి.',
      expiry: 'మా బెల్లం ఉత్పత్తులు సరిగ్గా నిల్వ చేసినప్పుడు తయారీ తేదీ నుండి 12 నెలల షెల్ఫ్ జీవితం కలిగి ఉంటాయి.',
      organic: 'అవును, మా బెల్లం 100% సేంద్రీయ చెరుకు నుండి తయారు చేయబడింది, ఇది పురుగుమందులు లేదా రసాయనాలు లేకుండా పెంచబడుతుంది.',
      bulk: 'అవును! 50 కిలోల కంటే ఎక్కువ బల్క్ ఆర్డర్ల కోసం, ప్రత్యేక ధర కోసం దయచేసి మమ్మల్ని సంప్రదించండి. WhatsApp: +91 9876543210'
    }
  },
  
  // KANNADA - ಕನ್ನಡ
  kn: {
    greeting: "ನಮಸ್ಕಾರ! 👋 GUDY ಗೆ ಸ್ವಾಗತ! ನಮ್ಮ ಪ್ರೀಮಿಯಂ ಬೆಲ್ಲದ ಉತ್ಪನ್ನಗಳಲ್ಲಿ ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನಾನು ಇಲ್ಲಿದ್ದೇನೆ. ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಬಹುದು?",
    contact: {
      phone: '+91 9876543210',
      email: 'support@gudy.com',
      whatsapp: '+91 9876543210',
      hours: 'ಸೋಮವಾರದಿಂದ ಶನಿವಾರದವರೆಗೆ, ಬೆಳಿಗ್ಗೆ 9 ರಿಂದ ಸಂಜೆ 6 ರವರೆಗೆ'
    },
    faqs: {
      shipping: '₹299 ಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಎಲ್ಲಾ ಆರ್ಡರ್‌ಗಳಲ್ಲಿ ಉಚಿತ ಶಿಪ್ಪಿಂಗ್. ₹299 ಕ್ಕಿಂತ ಕಡಿಮೆ ಆರ್ಡರ್‌ಗಳಿಗೆ ₹40 ಶಿಪ್ಪಿಂಗ್ ಶುಲ್ಕ ಅನ್ವಯವಾಗುತ್ತದೆ.',
      delivery: 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಅವಲಂಬಿಸಿ ವಿತರಣೆಗೆ ಸಾಮಾನ್ಯವಾಗಿ 3-7 ವ್ಯಾಪಾರ ದಿನಗಳು ತೆಗೆದುಕೊಳ್ಳುತ್ತದೆ. ಮೆಟ್ರೋ ನಗರಗಳಿಗೆ 3-4 ದಿನಗಳಲ್ಲಿ ಆರ್ಡರ್‌ಗಳು ಸಿಗುತ್ತವೆ.',
      cod: 'ಹೌದು! ನಾವು ಎಲ್ಲಾ ಆರ್ಡರ್‌ಗಳಿಗೆ ಕ್ಯಾಶ್ ಆನ್ ಡೆಲಿವರಿ (COD) ಅನ್ನು ಸ್ವೀಕರಿಸುತ್ತೇವೆ. UPI, ಕಾರ್ಡ್‌ಗಳು ಅಥವಾ ನೆಟ್ ಬ್ಯಾಂಕಿಂಗ್ ಬಳಸಿಕೊಂಡು ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಪಾವತಿಸಬಹುದು.',
      returns: 'ನಮಗೆ 7-ದಿನದ ರಿಟರ್ನ್ ನೀತಿ ಇದೆ. ನಿಮಗೆ ಹಾನಿಗೊಳಗಾದ ಅಥವಾ ದೋಷಪೂರಿತ ಉತ್ಪನ್ನ ಸಿಕ್ಕರೆ, ಬದಲಿ ಅಥವಾ ಮರುಪಾವತಿಗಾಗಿ 7 ದಿನಗಳಲ್ಲಿ ನಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸಿ.',
      storage: 'ಗಾಳಿಯಾಡದ ಪಾತ್ರೆಯಲ್ಲಿ ತಂಪಾದ, ಒಣ ಸ್ಥಳದಲ್ಲಿ ಸಂಗ್ರಹಿಸಿ. ಗಟ್ಟಿಯಾಗುವುದನ್ನು ತಡೆಯಲು ತೇವಾಂಶದಿಂದ ದೂರವಿರಿಸಿ.',
      expiry: 'ನಮ್ಮ ಬೆಲ್ಲದ ಉತ್ಪನ್ನಗಳು ಸರಿಯಾಗಿ ಸಂಗ್ರಹಿಸಿದಾಗ ತಯಾರಿಕೆಯ ದಿನಾಂಕದಿಂದ 12 ತಿಂಗಳ ಶೆಲ್ಫ್ ಲೈಫ್ ಅನ್ನು ಹೊಂದಿವೆ.',
      organic: 'ಹೌದು, ನಮ್ಮ ಬೆಲ್ಲವನ್ನು 100% ಸಾವಯವ ಕಬ್ಬಿನಿಂದ ತಯಾರಿಸಲಾಗುತ್ತದೆ, ಅದನ್ನು ಕೀಟನಾಶಕಗಳು ಅಥವಾ ರಾಸಾಯನಿಕಗಳಿಲ್ಲದೆ ಬೆಳೆಸಲಾಗುತ್ತದೆ.',
      bulk: 'ಹೌದು! 50 ಕೆಜಿಗಿಂತ ಹೆಚ್ಚಿನ ಬಲ್ಕ್ ಆರ್ಡರ್‌ಗಳಿಗೆ, ವಿಶೇಷ ಬೆಲೆಗಾಗಿ ದಯವಿಟ್ಟು ನಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸಿ. WhatsApp: +91 9876543210'
    }
  },
  
  // MALAYALAM - മലയാളം
  ml: {
    greeting: "നമസ്കാരം! 👋 GUDY-യിലേക്ക് സ്വാഗതം! ഞങ്ങളുടെ പ്രീമിയം ശർക്കര ഉൽപ്പന്നങ്ങളിൽ നിങ്ങളെ സഹായിക്കാൻ ഞാൻ ഇവിടെയുണ്ട്. എനിക്ക് എങ്ങനെ സഹായിക്കാം?",
    contact: {
      phone: '+91 9876543210',
      email: 'support@gudy.com',
      whatsapp: '+91 9876543210',
      hours: 'തിങ്കൾ മുതൽ ശനി വരെ, രാവിലെ 9 മണി മുതൽ വൈകുന്നേരം 6 മണി വരെ'
    },
    faqs: {
      shipping: '₹299-ന് മുകളിലുള്ള എല്ലാ ഓർഡറുകൾക്കും സൗജന്യ ഷിപ്പിംഗ്. ₹299-ൽ താഴെയുള്ള ഓർഡറുകൾക്ക് ₹40 ഷിപ്പിംഗ് ചാർജ് ബാധകമാണ്.',
      delivery: 'നിങ്ങളുടെ സ്ഥലത്തെ ആശ്രയിച്ച് ഡെലിവറിയിൽ സാധാരണയായി 3-7 പ്രവൃത്തി ദിവസങ്ങൾ എടുക്കും. മെട്രോ നഗരങ്ങളിൽ 3-4 ദിവസങ്ങൾക്കുള്ളിൽ ഓർഡറുകൾ ലഭിക്കും.',
      cod: 'അതെ! എല്ലാ ഓർഡറുകൾക്കും ഞങ്ങൾ ക്യാഷ് ഓൺ ഡെലിവറി (COD) സ്വീകരിക്കുന്നു. UPI, കാർഡുകൾ, അല്ലെങ്കിൽ നെറ്റ് ബാങ്കിംഗ് ഉപയോഗിച്ച് ഓൺലൈനായി പണമടയ്ക്കാം.',
      returns: 'ഞങ്ങൾക്ക് 7 ദിവസത്തെ റിട്ടേൺ പോളിസി ഉണ്ട്. കേടായതോ വികലമായതോ ആയ ഉൽപ്പന്നം ലഭിച്ചാൽ, മാറ്റിസ്ഥാപനത്തിനോ റീഫണ്ടിനോ 7 ദിവസത്തിനുള്ളിൽ ഞങ്ങളെ ബന്ധപ്പെടുക.',
      storage: 'വായുകടക്കാത്ത പാത്രത്തിൽ തണുത്തതും വരണ്ടതുമായ സ്ഥലത്ത് സൂക്ഷിക്കുക. കഠിനമാകുന്നത് തടയാൻ ഈർപ്പത്തിൽ നിന്ന് അകറ്റി നിർത്തുക.',
      expiry: 'ശരിയായി സൂക്ഷിച്ചാൽ നിർമ്മാണ തീയതി മുതൽ ഞങ്ങളുടെ ശർക്കര ഉൽപ്പന്നങ്ങൾക്ക് 12 മാസത്തെ ഷെൽഫ് ലൈഫ് ഉണ്ട്.',
      organic: 'അതെ, ഞങ്ങളുടെ ശർക്കര 100% ജൈവ കരിമ്പിൽ നിന്ന് നിർമ്മിച്ചതാണ്, ഇത് കീടനാശിനികളോ രാസവസ്തുക്കളോ ഇല്ലാതെ വളർത്തുന്നു.',
      bulk: 'അതെ! 50 കിലോയിൽ കൂടുതലുള്ള ബൾക്ക് ഓർഡറുകൾക്ക്, പ്രത്യേക വിലനിർണ്ണയത്തിനായി ഞങ്ങളെ ബന്ധപ്പെടുക. WhatsApp: +91 9876543210'
    }
  },
  
  // Add other languages...
  mr: {
    greeting: "नमस्कार! 👋 GUDY मध्ये आपले स्वागत आहे! आमच्या प्रीमियम गूळ उत्पादनांमध्ये तुम्हाला मदत करण्यासाठी मी येथे आहे. मी कशी मदत करू शकतो?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'सोमवार ते शनिवार, सकाळी 9 ते संध्याकाळी 6' },
    faqs: {
      shipping: '₹299 पेक्षा जास्त ऑर्डरवर मोफत शिपिंग. ₹299 पेक्षा कमी ऑर्डरसाठी ₹40 शिपिंग शुल्क लागू.',
      delivery: 'तुमच्या स्थानानुसार डिलिव्हरीला साधारणपणे 3-7 व्यावसायिक दिवस लागतात.',
      cod: 'होय! आम्ही सर्व ऑर्डरसाठी कॅश ऑन डिलिव्हरी (COD) स्वीकारतो.',
      returns: '7-दिवसांची परतावा धोरण आहे.',
      storage: 'थंड, कोरड्या ठिकाणी एअरटाइट कंटेनरमध्ये साठवा.',
      expiry: 'योग्यरित्या साठवल्यास निर्मितीच्या तारखेपासून 12 महिने शेल्फ लाइफ.',
      organic: 'होय, आमचे गूळ 100% सेंद्रिय ऊसापासून बनवले जाते.',
      bulk: 'होय! 50 किलो पेक्षा जास्त ऑर्डरसाठी आमच्याशी संपर्क साधा. WhatsApp: +91 9876543210'
    }
  },
  
  bn: {
    greeting: "নমস্কার! 👋 GUDY-তে স্বাগতম! আমাদের প্রিমিয়াম গুড় পণ্যগুলিতে আপনাকে সাহায্য করতে আমি এখানে আছি। আমি কীভাবে সহায়তা করতে পারি?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'সোমবার থেকে শনিবার, সকাল 9টা থেকে সন্ধ্যা 6টা' },
    faqs: {
      shipping: '₹299-এর উপরে সমস্ত অর্ডারে বিনামূল্যে শিপিং। ₹299-এর নীচে অর্ডারের জন্য ₹40 শিপিং চার্জ প্রযোজ্য।',
      delivery: 'আপনার অবস্থানের উপর নির্ভর করে ডেলিভারিতে সাধারণত 3-7 কার্যদিবস সময় লাগে।',
      cod: 'হ্যাঁ! আমরা সমস্ত অর্ডারের জন্য ক্যাশ অন ডেলিভারি (COD) গ্রহণ করি।',
      returns: 'আমাদের 7-দিনের রিটার্ন নীতি আছে।',
      storage: 'একটি বায়ুরোধী পাত্রে শীতল, শুষ্ক জায়গায় সংরক্ষণ করুন।',
      expiry: 'যথাযথভাবে সংরক্ষণ করলে উৎপাদনের তারিখ থেকে 12 মাসের শেলফ লাইফ।',
      organic: 'হ্যাঁ, আমাদের গুড় 100% জৈব আখ থেকে তৈরি।',
      bulk: 'হ্যাঁ! 50 কেজির বেশি বাল্ক অর্ডারের জন্য আমাদের সাথে যোগাযোগ করুন। WhatsApp: +91 9876543210'
    }
  },
  
  gu: {
    greeting: "નમસ્તે! 👋 GUDY માં આપનું સ્વાગત છે! અમારા પ્રીમિયમ ગોળ ઉત્પાદનોમાં તમને મદદ કરવા હું અહીં છું. હું કેવી રીતે મદદ કરી શકું?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'સોમવારથી શનિવાર, સવારે 9 થી સાંજે 6' },
    faqs: {
      shipping: '₹299 થી વધુના તમામ ઓર્ડર પર મફત શિપિંગ। ₹299 થી ઓછા ઓર્ડર માટે ₹40 શિપિંગ ચાર્જ લાગુ પડે છે।',
      delivery: 'તમારા સ્થાન પર આધાર રાખીને ડિલિવરીમાં સામાન્ય રીતે 3-7 વ્યાવસાયિક દિવસ લાગે છે।',
      cod: 'હા! અમે તમામ ઓર્ડર માટે કેશ ઓન ડિલિવરી (COD) સ્વીકારીએ છીએ।',
      returns: 'અમારી પાસે 7-દિવસની રિટર્ન પોલિસી છે।',
      storage: 'એરટાઇટ કન્ટેનરમાં ઠંડી, સૂકી જગ્યાએ સંગ્રહિત કરો।',
      expiry: 'યોગ્ય રીતે સંગ્રહિત કરવામાં આવે તો ઉત્પાદનની તારીખથી 12 મહિનાની શેલ્ફ લાઇફ।',
      organic: 'હા, અમારો ગોળ 100% ઓર્ગેનિક શેરડીમાંથી બનાવવામાં આવે છે।',
      bulk: 'હા! 50 કિલોથી વધુ બલ્ક ઓર્ડર માટે કૃપા કરીને અમારો સંપર્ક કરો। WhatsApp: +91 9876543210'
    }
  },
  
  pa: {
    greeting: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! 👋 GUDY ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ! ਸਾਡੇ ਪ੍ਰੀਮੀਅਮ ਗੁੜ ਉਤਪਾਦਾਂ ਵਿੱਚ ਤੁਹਾਡੀ ਮਦਦ ਕਰਨ ਲਈ ਮੈਂ ਇੱਥੇ ਹਾਂ। ਮੈਂ ਕਿਵੇਂ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'ਸੋਮਵਾਰ ਤੋਂ ਸ਼ਨੀਵਾਰ, ਸਵੇਰੇ 9 ਤੋਂ ਸ਼ਾਮ 6' },
    faqs: {
      shipping: '₹299 ਤੋਂ ਵੱਧ ਦੇ ਸਾਰੇ ਆਰਡਰਾਂ ਤੇ ਮੁਫ਼ਤ ਸ਼ਿਪਿੰਗ। ₹299 ਤੋਂ ਘੱਟ ਆਰਡਰਾਂ ਲਈ ₹40 ਸ਼ਿਪਿੰਗ ਖਰਚੇ ਲਾਗੂ ਹੁੰਦੇ ਹਨ।',
      delivery: 'ਤੁਹਾਡੀ ਸਥਿਤੀ ਦੇ ਆਧਾਰ ਤੇ ਡਿਲੀਵਰੀ ਵਿੱਚ ਆਮ ਤੌਰ ਤੇ 3-7 ਕਾਰੋਬਾਰੀ ਦਿਨ ਲੱਗਦੇ ਹਨ।',
      cod: 'ਹਾਂ! ਅਸੀਂ ਸਾਰੇ ਆਰਡਰਾਂ ਲਈ ਕੈਸ਼ ਆਨ ਡਿਲੀਵਰੀ (COD) ਸਵੀਕਾਰ ਕਰਦੇ ਹਾਂ।',
      returns: 'ਸਾਡੀ 7-ਦਿਨ ਦੀ ਵਾਪਸੀ ਨੀਤੀ ਹੈ।',
      storage: 'ਏਅਰਟਾਈਟ ਕੰਟੇਨਰ ਵਿੱਚ ਠੰਡੀ, ਸੁੱਕੀ ਥਾਂ ਤੇ ਸਟੋਰ ਕਰੋ।',
      expiry: 'ਸਹੀ ਢੰਗ ਨਾਲ ਸਟੋਰ ਕੀਤੇ ਜਾਣ ਤੇ ਨਿਰਮਾਣ ਮਿਤੀ ਤੋਂ 12 ਮਹੀਨਿਆਂ ਦੀ ਸ਼ੈਲਫ ਲਾਈਫ।',
      organic: 'ਹਾਂ, ਸਾਡਾ ਗੁੜ 100% ਜੈਵਿਕ ਗੰਨੇ ਤੋਂ ਬਣਾਇਆ ਗਿਆ ਹੈ।',
      bulk: 'ਹਾਂ! 50 ਕਿਲੋ ਤੋਂ ਵੱਧ ਦੇ ਬਲਕ ਆਰਡਰਾਂ ਲਈ, ਕਿਰਪਾ ਕਰਕੇ ਸਾਡੇ ਨਾਲ ਸੰਪਰਕ ਕਰੋ। WhatsApp: +91 9876543210'
    }
  },
  
  // International languages
  es: {
    greeting: "¡Hola! 👋 ¡Bienvenido a GUDY! Estoy aquí para ayudarte con nuestros productos premium de jaggery. ¿Cómo puedo asistirte hoy?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'Lunes a Sábado, 9 AM - 6 PM' },
    faqs: {
      shipping: 'Ofrecemos envío GRATIS en todos los pedidos superiores a ₹299. Para pedidos inferiores a ₹299, se aplican cargos de envío estándar de ₹40.',
      delivery: 'La entrega generalmente toma de 3 a 7 días hábiles dependiendo de tu ubicación.',
      cod: '¡Sí! Aceptamos Pago Contra Entrega (COD) para todos los pedidos.',
      returns: 'Tenemos una política de devolución de 7 días.',
      storage: 'Almacenar en un lugar fresco y seco en un recipiente hermético.',
      expiry: 'Nuestros productos tienen una vida útil de 12 meses desde la fecha de fabricación cuando se almacenan correctamente.',
      organic: 'Sí, nuestro jaggery está hecho de caña de azúcar 100% orgánica.',
      bulk: '¡Sí! Para pedidos al por mayor de más de 50 kg, contáctanos. WhatsApp: +91 9876543210'
    }
  },
  
  fr: {
    greeting: "Bonjour! 👋 Bienvenue chez GUDY! Je suis là pour vous aider avec nos produits premium de jaggery. Comment puis-je vous aider aujourd'hui?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'Lundi au Samedi, 9h - 18h' },
    faqs: {
      shipping: 'Nous offrons la livraison GRATUITE sur toutes les commandes supérieures à ₹299. Pour les commandes inférieures à ₹299, des frais de livraison standard de ₹40 s\'appliquent.',
      delivery: 'La livraison prend généralement 3 à 7 jours ouvrables selon votre emplacement.',
      cod: 'Oui! Nous acceptons le paiement à la livraison (COD) pour toutes les commandes.',
      returns: 'Nous avons une politique de retour de 7 jours.',
      storage: 'Conserver dans un endroit frais et sec dans un récipient hermétique.',
      expiry: 'Nos produits ont une durée de conservation de 12 mois à partir de la date de fabrication lorsqu\'ils sont stockés correctement.',
      organic: 'Oui, notre jaggery est fabriqué à partir de canne à sucre 100% biologique.',
      bulk: 'Oui! Pour les commandes en gros de plus de 50 kg, veuillez nous contacter. WhatsApp: +91 9876543210'
    }
  },
  
  de: {
    greeting: "Hallo! 👋 Willkommen bei GUDY! Ich bin hier, um Ihnen bei unseren Premium-Jaggery-Produkten zu helfen. Wie kann ich Ihnen heute helfen?",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'Montag bis Samstag, 9 - 18 Uhr' },
    faqs: {
      shipping: 'Wir bieten KOSTENLOSEN Versand für alle Bestellungen über ₹299. Für Bestellungen unter ₹299 fallen Standardversandkosten von ₹40 an.',
      delivery: 'Die Lieferung dauert in der Regel 3-7 Werktage, abhängig von Ihrem Standort.',
      cod: 'Ja! Wir akzeptieren Nachnahme (COD) für alle Bestellungen.',
      returns: 'Wir haben eine 7-tägige Rückgaberichtlinie.',
      storage: 'An einem kühlen, trockenen Ort in einem luftdichten Behälter aufbewahren.',
      expiry: 'Unsere Produkte haben eine Haltbarkeit von 12 Monaten ab Herstellungsdatum bei ordnungsgemäßer Lagerung.',
      organic: 'Ja, unser Jaggery wird aus 100% biologischem Zuckerrohr hergestellt.',
      bulk: 'Ja! Für Großbestellungen über 50 kg kontaktieren Sie uns bitte. WhatsApp: +91 9876543210'
    }
  },
  
  ar: {
    greeting: "مرحباً! 👋 مرحباً بك في GUDY! أنا هنا لمساعدتك في منتجاتنا المتميزة من الجاغري. كيف يمكنني مساعدتك اليوم؟",
    contact: { phone: '+91 9876543210', email: 'support@gudy.com', whatsapp: '+91 9876543210', hours: 'الإثنين إلى السبت، 9 صباحاً - 6 مساءً' },
    faqs: {
      shipping: 'نقدم شحن مجاني على جميع الطلبات التي تزيد عن ₹299. للطلبات التي تقل عن ₹299، تطبق رسوم شحن قياسية قدرها ₹40.',
      delivery: 'عادة ما يستغرق التسليم من 3 إلى 7 أيام عمل حسب موقعك.',
      cod: 'نعم! نقبل الدفع عند الاستلام (COD) لجميع الطلبات.',
      returns: 'لدينا سياسة إرجاع لمدة 7 أيام.',
      storage: 'التخزين في مكان بارد وجاف في حاوية محكمة الإغلاق.',
      expiry: 'منتجاتنا لها عمر تخزين مدته 12 شهراً من تاريخ التصنيع عند التخزين بشكل صحيح.',
      organic: 'نعم، يُصنع الجاغري لدينا من قصب السكر العضوي 100%.',
      bulk: 'نعم! للطلبات بالجملة التي تزيد عن 50 كجم، يرجى الاتصال بنا. WhatsApp: +91 9876543210'
    }
  }
};

// Language name mapping for prompts
const languageNames = {
  en: 'English',
  hi: 'Hindi (हिंदी)',
  ta: 'Tamil (தமிழ்)',
  te: 'Telugu (తెలుగు)',
  kn: 'Kannada (ಕನ್ನಡ)',
  ml: 'Malayalam (മലയാളം)',
  mr: 'Marathi (मराठी)',
  bn: 'Bengali (বাংলা)',
  gu: 'Gujarati (ગુજરાતી)',
  pa: 'Punjabi (ਪੰਜਾਬੀ)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  ar: 'Arabic (العربية)'
};

// ==================== PRODUCT DATA ====================

const productData = {
  powder: [
    { id: 'pw1kg', name: 'Jaggery Powder 1kg', price: 99, weight: '1kg', category: 'powder' },
    { id: 'pw2kg', name: 'Jaggery Powder 2kg', price: 199, weight: '2kg', category: 'powder' },
    { id: 'pw3kg', name: 'Jaggery Powder 3kg', price: 299, weight: '3kg', category: 'powder' },
    { id: 'pw5kg', name: 'Jaggery Powder 5kg', price: 399, weight: '5kg', category: 'powder' }
  ],
  cubes: [
    { id: 'cb1kg', name: 'Jaggery Cubes 1kg', price: 198, weight: '1kg', category: 'cubes' },
    { id: 'cb2kg', name: 'Jaggery Cubes 2kg', price: 398, weight: '2kg', category: 'cubes' },
    { id: 'cb3kg', name: 'Jaggery Cubes 3kg', price: 598, weight: '3kg', category: 'cubes' },
    { id: 'cb5kg', name: 'Jaggery Cubes 5kg', price: 798, weight: '5kg', category: 'cubes' }
  ]
};

// ==================== CHATBOT FUNCTIONS ====================

// Build system prompt based on language and user context
async function buildSystemPrompt(userId, language = 'en') {
  const t = translations[language] || translations.en;
  
  let orderHistory = '';
  if (userId) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user) {
        const userOrders = await db.select()
          .from(orders)
          .where(eq(orders.userId, userId))
          .orderBy(desc(orders.createdAt))
          .limit(5);
        
        if (userOrders.length > 0) {
          orderHistory = `\n\nCustomer Order History:\n${userOrders.map((o, i) => 
            `${i+1}. Order #${o.id} - ₹${o.totalAmount} - ${o.status} (${new Date(o.createdAt).toLocaleDateString()})`
          ).join('\n')}`;
        }
      }
    } catch (error) {
      console.error('Error fetching order history:', error);
    }
  }

  const systemPrompt = `You are a helpful, friendly customer support assistant for GUDY, an online jaggery (gur/வெல்லம்/బెల్లం) store.

PRODUCT CATALOG:
🍯 Jaggery Powder:
- 1kg: ₹99
- 2kg: ₹199
- 3kg: ₹299 (FREE SHIPPING!)
- 5kg: ₹399 (FREE SHIPPING!)

🧊 Jaggery Cubes:
- 1kg: ₹198
- 2kg: ₹398 (FREE SHIPPING!)
- 3kg: ₹598 (FREE SHIPPING!)
- 5kg: ₹798 (FREE SHIPPING!)

CONTACT INFORMATION:
📞 Phone: ${t.contact.phone}
📧 Email: ${t.contact.email}
💬 WhatsApp: ${t.contact.whatsapp}
⏰ Hours: ${t.contact.hours}

KEY FAQs:
🚚 Shipping: ${t.faqs.shipping}
📦 Delivery: ${t.faqs.delivery}
💰 Payment: ${t.faqs.cod}
🔄 Returns: ${t.faqs.returns}
📦 Storage: ${t.faqs.storage}
⏳ Shelf Life: ${t.faqs.expiry}
🌱 Organic: ${t.faqs.organic}
📦 Bulk Orders: ${t.faqs.bulk}${orderHistory}

TONE & STYLE:
- Be warm, friendly, and conversational
- Use emojis appropriately (🎯 💚 ✨ 📦 etc.)
- Respond in ${languageNames[language] || 'English'}
- Provide specific product recommendations based on customer needs
- Reference customer's order history when relevant
- Always mention free shipping on orders above ₹299
- Highlight health benefits of jaggery (iron-rich, natural sweetener, immunity booster)
- If asked about orders, refer to the order history if available
- Keep responses concise and actionable
- Suggest quick replies for common actions
- Be proactive in helping customers complete purchases

IMPORTANT: 
- Always be accurate about pricing and product details
- Never make up information not provided in the system prompt
- If you don't know something, direct customers to contact support`;

  return systemPrompt;
}

// Call Groq API with better error handling
async function callGroqAPI(messages, systemPrompt) {
  try {
    if (!GROQ_API_KEY || GROQ_API_KEY.trim() === '') {
      throw new Error('GROQ_API_KEY is not configured');
    }

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 1,
        stream: false
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (!response.data || !response.data.choices || !response.data.choices[0]) {
      throw new Error('Invalid response from Groq API');
    }

    return response.data.choices[0].message.content;
  } catch (error) {
    if (error.response) {
      console.error('Groq API Error Response:', {
        status: error.response.status,
        data: error.response.data
      });
    } else {
      console.error('Groq API Error:', error.message);
    }
    throw new Error('Failed to get AI response');
  }
}

// Generate quick replies based on context and language
function generateQuickReplies(message, language = 'en') {
  const quickRepliesMap = {
    en: {
      default: ["View products", "Shipping info", "Track order", "Contact support"],
      products: ["Powder products", "Cube products", "Health benefits", "Place order"],
      order: ["Track order", "Order status", "Return policy", "Contact support"],
      cart: ["View cart", "Checkout", "Continue shopping", "Clear cart"],
      shipping: ["Track order", "Return policy", "Contact support", "View products"]
    },
    hi: {
      default: ["उत्पाद देखें", "शिपिंग जानकारी", "ऑर्डर ट्रैक करें", "सहायता से संपर्क करें"],
      products: ["पाउडर उत्पाद", "क्यूब उत्पाद", "स्वास्थ्य लाभ", "ऑर्डर करें"],
      order: ["ऑर्डर ट्रैक करें", "ऑर्डर स्थिति", "रिटर्न पॉलिसी", "सहायता से संपर्क करें"],
      cart: ["कार्ट देखें", "चेकआउट", "खरीदारी जारी रखें", "कार्ट साफ़ करें"],
      shipping: ["ऑर्डर ट्रैक करें", "रिटर्न पॉलिसी", "सहायता से संपर्क करें", "उत्पाद देखें"]
    },
    ta: {
      default: ["தயாரிப்புகளைக் காண்க", "ஷிப்பிங் தகவல்", "ஆர்டரைக் கண்காணிக்கவும்", "ஆதரவைத் தொடர்பு கொள்ளுங்கள்"],
      products: ["பொடி தயாரிப்புகள்", "க்யூப் தயாரிப்புகள்", "ஆரோக்கிய நன்மைகள்", "ஆர்டர் செய்யுங்கள்"],
      order: ["ஆர்டரைக் கண்காணிக்கவும்", "ஆர்டர் நிலை", "திரும்பப் பெறும் கொள்கை", "ஆதரவைத் தொடர்பு கொள்ளுங்கள்"],
      cart: ["கார்ட்டைக் காண்க", "செக்அவுட்", "ஷாப்பிங் தொடரவும்", "கார்ட்டை அழிக்கவும்"],
      shipping: ["ஆர்டரைக் கண்காணிக்கவும்", "திரும்பப் பெறும் கொள்கை", "ஆதரவைத் தொடர்பு கொள்ளுங்கள்", "தயாரிப்புகளைக் காண்க"]
    },
    te: {
      default: ["ఉత్పత్తులను చూడండి", "షిప్పింగ్ సమాచారం", "ఆర్డర్‌ను ట్రాక్ చేయండి", "మద్దతును సంప్రదించండి"],
      products: ["పొడి ఉత్పత్తులు", "క్యూబ్ ఉత్పత్తులు", "ఆరోగ్య ప్రయోజనాలు", "ఆర్డర్ చేయండి"],
      order: ["ఆర్డర్‌ను ట్రాక్ చేయండి", "ఆర్డర్ స్థితి", "రిటర్న్ విధానం", "మద్దతును సంప్రదించండి"],
      cart: ["కార్ట్‌ను చూడండి", "చెక్అవుట్", "షాపింగ్ కొనసాగించండి", "కార్ట్‌ను క్లియర్ చేయండి"],
      shipping: ["ఆర్డర్‌ను ట్రాక్ చేయండి", "రిటర్న్ విధానం", "మద్దతును సంప్రదించండి", "ఉత్పత్తులను చూడండి"]
    }
    // Add more languages as needed following same pattern
  };

  const msgLower = message.toLowerCase();
  
  let context = 'default';
  if (msgLower.includes('product') || msgLower.includes('buy') || msgLower.includes('powder') || msgLower.includes('cube')) {
    context = 'products';
  } else if (msgLower.includes('order') || msgLower.includes('track')) {
    context = 'order';
  } else if (msgLower.includes('cart')) {
    context = 'cart';
  } else if (msgLower.includes('ship') || msgLower.includes('deliver')) {
    context = 'shipping';
  }

  const langReplies = quickRepliesMap[language] || quickRepliesMap.en;
  return langReplies[context] || langReplies.default;
}

// Fallback responses when Groq is not available - CORRECTED VERSION
function generateFallbackResponse(message, language = 'en') {
  const t = translations[language] || translations.en;
  const msgLower = message.toLowerCase();

  // Check for greeting/initial message
  if (msgLower.includes('hello') || msgLower.includes('hi') || msgLower.includes('hey') || 
      msgLower.includes('வணக்கம்') || msgLower.includes('नमस्ते') || msgLower.includes('నమస్కారం') ||
      msgLower === 'start' || message.trim() === '') {
    return {
      message: t.greeting,
      quickReplies: generateQuickReplies('greeting', language)
    };
  }

  if (msgLower.includes('product') || msgLower.includes('powder') || msgLower.includes('cube') ||
      msgLower.includes('தயாரிப்பு') || msgLower.includes('பொடி') || msgLower.includes('उत्पाद') || 
      msgLower.includes('పొడి') || msgLower.includes('ఉత్పత్తి')) {
    const productMessages = {
      en: "We offer premium Jaggery Powder and Jaggery Cubes in various sizes:\n\n🍯 POWDER PACKS:\n• 1kg - ₹99\n• 2kg - ₹199\n• 3kg - ₹299\n• 5kg - ₹399\n\n🧊 CUBE PACKS:\n• 1kg - ₹198\n• 2kg - ₹398\n• 3kg - ₹598\n• 5kg - ₹798\n\n✨ FREE shipping on orders above ₹299!",
      hi: "हम विभिन्न आकारों में प्रीमियम गुड़ पाउडर और गुड़ क्यूब्स प्रदान करते हैं:\n\n🍯 पाउडर पैक:\n• 1kg - ₹99\n• 2kg - ₹199\n• 3kg - ₹299\n• 5kg - ₹399\n\n🧊 क्यूब पैक:\n• 1kg - ₹198\n• 2kg - ₹398\n• 3kg - ₹598\n• 5kg - ₹798\n\n✨ ₹299 से अधिक के ऑर्डर पर मुफ्त शिपिंग!",
      ta: "பல்வேறு அளவுகளில் பிரீமியம் வெல்லம் பொடி மற்றும் வெல்லம் க்யூப்ஸ் வழங்குகிறோம்:\n\n🍯 பொடி பேக்குகள்:\n• 1kg - ₹99\n• 2kg - ₹199\n• 3kg - ₹299\n• 5kg - ₹399\n\n🧊 க்யூப் பேக்குகள்:\n• 1kg - ₹198\n• 2kg - ₹398\n• 3kg - ₹598\n• 5kg - ₹798\n\n✨ ₹299 க்கு மேல் ஆர்டர்களுக்கு இலவச ஷிப்பிங்!",
      te: "మేము వివిధ పరిమాణాలలో ప్రీమియం బెల్లం పొడి మరియు బెల్లం క్యూబ్స్ అందిస్తాము:\n\n🍯 పొడి పాక్‌లు:\n• 1kg - ₹99\n• 2kg - ₹199\n• 3kg - ₹299\n• 5kg - ₹399\n\n🧊 క్యూబ్ పాక్‌లు:\n• 1kg - ₹198\n• 2kg - ₹398\n• 3kg - ₹598\n• 5kg - ₹798\n\n✨ ₹299 పైగా ఆర్డర్లకు ఉచిత షిప్పింగ్!",
      kn: "ನಾವು ವಿವಿಧ ಗಾತ್ರಗಳಲ್ಲಿ ಪ್ರೀಮಿಯಂ ಬೆಲ್ಲದ ಪುಡಿ ಮತ್ತು ಬೆಲ್ಲದ ಕ್ಯೂಬ್ಸ್ ನೀಡುತ್ತೇವೆ:\n\n🍯 ಪುಡಿ ಪ್ಯಾಕ್‌ಗಳು:\n• 1kg - ₹99\n• 2kg - ₹199\n• 3kg - ₹299\n• 5kg - ₹399\n\n🧊 ಕ್ಯೂಬ್ ಪ್ಯಾಕ್‌ಗಳು:\n• 1kg - ₹198\n• 2kg - ₹398\n• 3kg - ₹598\n• 5kg - ₹798\n\n✨ ₹299 ಮೇಲಿನ ಆರ್ಡರ್‌ಗಳಿಗೆ ಉಚಿತ ಶಿಪ್ಪಿಂಗ್!",
      ml: "ഞങ്ങൾ വിവിധ വലുപ്പങ്ങളിൽ പ്രീമിയം ശർക്കര പൊടിയും ശർക്കര ക്യൂബുകളും വാഗ്ദാനം ചെയ്യുന്നു:\n\n🍯 പൊടി പായ്ക്കുകൾ:\n• 1kg - ₹99\n• 2kg - ₹199\n• 3kg - ₹299\n• 5kg - ₹399\n\n🧊 ക്യൂബ് പായ്ക്കുകൾ:\n• 1kg - ₹198\n• 2kg - ₹398\n• 3kg - ₹598\n• 5kg - ₹798\n\n✨ ₹299 മുകളിലുള്ള ഓർഡറുകൾക്ക് സൗജന്യ ഷിപ്പിംഗ്!"
    };
    return {
      message: productMessages[language] || productMessages.en,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  // Enhanced shipping/delivery fallback with multi-language support
  // Check if message contains shipping-related terms
  const isShippingRelated = msgLower.includes('ship') || msgLower.includes('deliver') || 
      msgLower.includes('delivery') || msgLower.includes('shipping') || 
      msgLower.includes('freight') || msgLower.includes('courier') ||
      msgLower.includes('dispatch') || msgLower.includes('send') || 
      msgLower.includes('transport') || msgLower.includes('when will') || 
      msgLower.includes('how long') || msgLower.includes('track') ||
      msgLower.includes('arrive') || msgLower.includes('reach') || 
      msgLower.includes('receive') || msgLower.includes('info') ||
      msgLower.includes('shipping info') || msgLower.includes('शिपिंग जानकारी') || 
      msgLower.includes('ஷிப்பிங் தகவல்') || msgLower.includes('షిప్పింగ్ సమాచారం') ||
      msgLower.includes('जानकारी') || msgLower.includes('தகவல்') || msgLower.includes('సమాచారం') ||
      msgLower.includes('ಮಾಹಿತಿ') || msgLower.includes('വിവരം') || msgLower.includes('माहिती') ||
      msgLower.includes('তথ্য') || msgLower.includes('માહિતી') || msgLower.includes('ਜਾਣਕਾਰੀ') ||
      msgLower.includes('शिपिंग') || msgLower.includes('डिलीवरी') || msgLower.includes('वितरण') ||
      msgLower.includes('ஷிப்பிங்') || msgLower.includes('டெலிவரி') || msgLower.includes('விநியோகம்') ||
      msgLower.includes('షిప్పింగ్') || msgLower.includes('డెలివరీ') || msgLower.includes('పంపిణీ') ||
      msgLower.includes('ಶಿಪ್ಪಿಂಗ್') || msgLower.includes('ಡೆಲಿವರಿ') || msgLower.includes('ವಿತರಣೆ') ||
      msgLower.includes('ഷിപ്പിംഗ്') || msgLower.includes('ഡെലിവറി') || msgLower.includes('വിതരണം') ||
      msgLower.includes('शिपींग') || msgLower.includes('डिलिव्हरी') || msgLower.includes('পাঠানো') ||
      msgLower.includes('ডেলিভারি') || msgLower.includes('શિપિંગ') || msgLower.includes('ડિલિવરી') ||
      msgLower.includes('ਸ਼ਿਪਿੰਗ') || msgLower.includes('ਡਿਲੀਵਰੀ');
  
  if (isShippingRelated) {
    const shippingHeaders = {
      en: '📦 Shipping Information',
      hi: '📦 शिपिंग जानकारी',
      ta: '📦 ஷிப்பிங் தகவல்',
      te: '📦 షిప్పింగ్ సమాచారం',
      kn: '📦 ಶಿಪ್ಪಿಂಗ್ ಮಾಹಿತಿ',
      ml: '📦 ഷിപ്പിംഗ് വിവരം',
      mr: '📦 शिपींग माहिती',
      bn: '📦 শিপিং তথ্য',
      gu: '📦 શિપિંગ માહિતી',
      pa: '📦 ਸ਼ਿਪਿੰਗ ਜਾਣਕਾਰੀ'
    };
    return {
      message: `${shippingHeaders[language] || shippingHeaders.en}\n\n${t.faqs.shipping}\n\n${t.faqs.delivery}`,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('cod') || msgLower.includes('payment') || msgLower.includes('pay')) {
    return {
      message: t.faqs.cod,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('return') || msgLower.includes('refund') || msgLower.includes('replace')) {
    return {
      message: t.faqs.returns,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('storage') || msgLower.includes('store') || msgLower.includes('keep')) {
    return {
      message: t.faqs.storage,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('expiry') || msgLower.includes('shelf life') || msgLower.includes('expire')) {
    return {
      message: t.faqs.expiry,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('organic') || msgLower.includes('natural') || msgLower.includes('chemical')) {
    return {
      message: t.faqs.organic,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('bulk') || msgLower.includes('wholesale') || msgLower.includes('50kg')) {
    return {
      message: t.faqs.bulk,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('price') || msgLower.includes('cost') || msgLower.includes('how much') ||
      msgLower.includes('விலை') || msgLower.includes('விலை') || msgLower.includes('कीमत') || 
      msgLower.includes('ధర') || msgLower.includes('ಬೆಲೆ')) {
    const priceMessages = {
      en: "Here are our prices:\n\n🍯 JAGGERY POWDER:\n• 1kg - ₹99 (67% off)\n• 2kg - ₹199 (67% off)\n• 3kg - ₹299 (67% off)\n• 5kg - ₹399 (73% off)\n\n🧊 JAGGERY CUBES:\n• 1kg - ₹198 (67% off)\n• 2kg - ₹398 (67% off)\n• 3kg - ₹598 (67% off)\n• 5kg - ₹798 (73% off)\n\n✨ FREE shipping on orders above ₹299!",
      hi: "यहाँ हमारी कीमतें हैं:\n\n🍯 गुड़ पाउडर:\n• 1kg - ₹99 (67% छूट)\n• 2kg - ₹199 (67% छूट)\n• 3kg - ₹299 (67% छूट)\n• 5kg - ₹399 (73% छूट)\n\n🧊 गुड़ क्यूब्स:\n• 1kg - ₹198 (67% छूट)\n• 2kg - ₹398 (67% छूट)\n• 3kg - ₹598 (67% छूट)\n• 5kg - ₹798 (73% छूट)\n\n✨ ₹299 से अधिक के ऑर्डर पर मुफ्त शिपिंग!",
      ta: "எங்கள் விலைகள் இதோ:\n\n🍯 வெல்லம் பொடி:\n• 1kg - ₹99 (67% தள்ளுபடி)\n• 2kg - ₹199 (67% தள்ளுபடி)\n• 3kg - ₹299 (67% தள்ளுபடி)\n• 5kg - ₹399 (73% தள்ளுபடி)\n\n🧊 வெல்லம் க்யூப்ஸ்:\n• 1kg - ₹198 (67% தள்ளுபடி)\n• 2kg - ₹398 (67% தள்ளுபடி)\n• 3kg - ₹598 (67% தள்ளுபடி)\n• 5kg - ₹798 (73% தள்ளுபடி)\n\n✨ ₹299 க்கு மேல் ஆர்டர்களுக்கு இலவச ஷிப்பிங்!",
      te: "మా ధరలు ఇవి:\n\n🍯 బెల్లం పౌడర్:\n• 1kg - ₹99 (67% డిస్కౌంట్)\n• 2kg - ₹199 (67% డిస్కౌంట్)\n• 3kg - ₹299 (67% డిస్కౌంట్)\n• 5kg - ₹399 (73% డిస్కౌంట్)\n\n🧊 బెల్లం క్యూబ్స్:\n• 1kg - ₹198 (67% డిస్కౌంట్)\n• 2kg - ₹398 (67% డిస్కౌంట్)\n• 3kg - ₹598 (67% డిస్కౌంట్)\n• 5kg - ₹798 (73% డిస్కౌంట్)\n\n✨ ₹299 పైగా ఆర్డర్లకు ఉచిత షిప్పింగ్!",
      kn: "ನಮ್ಮ ಬೆಲೆಗಳು ಇವು:\n\n🍯 ಬೆಲ್ಲದ ಪುಡಿ:\n• 1kg - ₹99 (67% ರಿಯಾಯಿತಿ)\n• 2kg - ₹199 (67% ರಿಯಾಯಿತಿ)\n• 3kg - ₹299 (67% ರಿಯಾಯಿತಿ)\n• 5kg - ₹399 (73% ರಿಯಾಯಿತಿ)\n\n🧊 ಬೆಲ್ಲದ ಕ್ಯೂಬ್ಸ್:\n• 1kg - ₹198 (67% ರಿಯಾಯಿತಿ)\n• 2kg - ₹398 (67% ರಿಯಾಯಿತಿ)\n• 3kg - ₹598 (67% ರಿಯಾಯಿತಿ)\n• 5kg - ₹798 (73% ರಿಯಾಯಿತಿ)\n\n✨ ₹299 ಮೇಲಿನ ಆರ್ಡರ್‌ಗಳಿಗೆ ಉಚಿತ ಶಿಪ್ಪಿಂಗ್!",
      ml: "ഞങ്ങളുടെ വിലകൾ ഇതാ:\n\n🍯 ശർക്കര പൊടി:\n• 1kg - ₹99 (67% കിഴിവ്)\n• 2kg - ₹199 (67% കിഴിവ്)\n• 3kg - ₹299 (67% കിഴിവ്)\n• 5kg - ₹399 (73% കിഴിവ്)\n\n🧊 ശർക്കര ക്യൂബുകൾ:\n• 1kg - ₹198 (67% കിഴിവ്)\n• 2kg - ₹398 (67% കിഴിവ്)\n• 3kg - ₹598 (67% കിഴിവ്)\n• 5kg - ₹798 (73% കിഴിവ്)\n\n✨ ₹299 മുകളിലുള്ള ഓർഡറുകൾക്ക് സൗജന്യ ഷിപ്പിംഗ്!",
      mr: "आमच्या किंमती येथे आहेत:\n\n🍯 गूळ पावडर:\n• 1kg - ₹99 (67% सूट)\n• 2kg - ₹199 (67% सूट)\n• 3kg - ₹299 (67% सूट)\n• 5kg - ₹399 (73% सूट)\n\n🧊 गूळ क्यूब्स:\n• 1kg - ₹198 (67% सूट)\n• 2kg - ₹398 (67% सूट)\n• 3kg - ₹598 (67% सूट)\n• 5kg - ₹798 (73% सूट)\n\n✨ ₹299 वरील ऑर्डरवर मोफत शिपिंग!",
      bn: "আমাদের দাম এখানে:\n\n🍯 গুড় পাউডার:\n• 1kg - ₹99 (67% ছাড়)\n• 2kg - ₹199 (67% ছাড়)\n• 3kg - ₹299 (67% ছাড়)\n• 5kg - ₹399 (73% ছাড়)\n\n🧊 গুড় কিউবস:\n• 1kg - ₹198 (67% ছাড়)\n• 2kg - ₹398 (67% ছাড়)\n• 3kg - ₹598 (67% ছাড়)\n• 5kg - ₹798 (73% ছাড়)\n\n✨ ₹299 এর উপরে অর্ডারে বিনামূল্যে শিপিং!",
      gu: "અમારી કિંમતો અહીં છે:\n\n🍯 ગોળ પાવડર:\n• 1kg - ₹99 (67% છૂટ)\n• 2kg - ₹199 (67% છૂટ)\n• 3kg - ₹299 (67% છૂટ)\n• 5kg - ₹399 (73% છૂટ)\n\n🧊 ગોળ ક્યુબ્સ:\n• 1kg - ₹198 (67% છૂટ)\n• 2kg - ₹398 (67% છૂટ)\n• 3kg - ₹598 (67% છૂટ)\n• 5kg - ₹798 (73% છૂટ)\n\n✨ ₹299 ઉપરના ઓર્ડર પર મફત શિપિંગ!",
      pa: "ਸਾਡੀਆਂ ਕੀਮਤਾਂ ਇੱਥੇ ਹਨ:\n\n🍯 ਗੁੜ ਪਾਊਡਰ:\n• 1kg - ₹99 (67% ਛੂਟ)\n• 2kg - ₹199 (67% ਛੂਟ)\n• 3kg - ₹299 (67% ਛੂਟ)\n• 5kg - ₹399 (73% ਛੂਟ)\n\n🧊 ਗੁੜ ਕਿਊਬਸ:\n• 1kg - ₹198 (67% ਛੂਟ)\n• 2kg - ₹398 (67% ਛੂਟ)\n• 3kg - ₹598 (67% ਛੂਟ)\n• 5kg - ₹798 (73% ਛੂਟ)\n\n✨ ₹299 ਤੋਂ ਉੱਪਰ ਦੇ ਆਰਡਰ ਤੇ ਮੁਫਤ ਸ਼ਿਪਿੰਗ!"
    };
    return {
      message: priceMessages[language] || priceMessages.en,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('benefit') || msgLower.includes('health') || msgLower.includes('good for') ||
      msgLower.includes('நன்மைகள்') || msgLower.includes('ஆரோக்கிய') || msgLower.includes('लाभ') || 
      msgLower.includes('स्वास्थ्य') || msgLower.includes('ప్రయోజనాలు') || msgLower.includes('ആരോഗ്യ')) {
    const healthMessages = {
      en: "🌿 Health Benefits of Jaggery:\n\n✅ Rich in iron - prevents anemia\n✅ Boosts immunity\n✅ Aids digestion\n✅ Cleanses the body\n✅ Natural energy source\n✅ Good for skin health\n✅ Relieves joint pain\n\nOur jaggery is 100% organic and chemical-free!",
      hi: "🌿 गुड़ के स्वास्थ्य लाभ:\n\n✅ आयरन से भरपूर - एनीमिया रोकता है\n✅ प्रतिरक्षा बढ़ाता है\n✅ पाचन में सहायक\n✅ शरीर को साफ करता है\n✅ प्राकृतिक ऊर्जा स्रोत\n✅ त्वचा के स्वास्थ्य के लिए अच्छा\n✅ जोड़ों के दर्द में राहत\n\nहमारा गुड़ 100% जैविक और रसायन मुक्त है!",
      ta: "🌿 வெல்லத்தின் ஆரோக்கிய நன்மைகள்:\n\n✅ இரும்புச்சத்து நிறைந்தது - இரத்தசோகையைத் தடுக்கிறது\n✅ நோய் எதிர்ப்பு சக்தியை அதிகரிக்கிறது\n✅ செரிமானத்திற்கு உதவுகிறது\n✅ உடலை சுத்தப்படுத்துகிறது\n✅ இயற்கை ஆற்றல் மூலம்\n✅ சரும ஆரோக்கியத்திற்கு நல்லது\n✅ மூட்டு வலியைக் குறைக்கிறது\n\nஎங்கள் வெல்லம் 100% இயற்கை மற்றும் இரசாயனம் இல்லாதது!",
      te: "🌿 బెల్లం ఆరోగ్య ప్రయోజనాలు:\n\n✅ ఇనుము పుష్కలంగా - రక్తహీనతను నివారిస్తుంది\n✅ రోగనిరోధక శక్తిని పెంచుతుంది\n✅ జీర్ణక్రియకు సహాయపడుతుంది\n✅ శరీరాన్ని శుభ్రపరుస్తుంది\n✅ సహజ శక్తి మూలం\n✅ చర్మ ఆరోగ్యానికి మంచిది\n✅ కీళ్ల నొప్పులను తగ్గిస్తుంది\n\nమా బెల్లం 100% సేంద్రీయ మరియు రసాయన రహితం!",
      kn: "🌿 ಬೆಲ್ಲದ ಆರೋಗ್ಯ ಪ್ರಯೋಜನಗಳು:\n\n✅ ಕಬ್ಬಿಣ ಸಮೃದ್ಧ - ರಕ್ತಹೀನತೆಯನ್ನು ತಡೆಯುತ್ತದೆ\n✅ ರೋಗನಿರೋಧಕ ಶಕ್ತಿಯನ್ನು ಹೆಚ್ಚಿಸುತ್ತದೆ\n✅ ಜೀರ್ಣಕ್ರಿಯೆಗೆ ಸಹಾಯ ಮಾಡುತ್ತದೆ\n✅ ದೇಹವನ್ನು ಶುದ್ಧೀಕರಿಸುತ್ತದೆ\n✅ ನೈಸರ್ಗಿಕ ಶಕ್ತಿ ಮೂಲ\n✅ ಚರ್ಮದ ಆರೋಗ್ಯಕ್ಕೆ ಒಳ್ಳೆಯದು\n✅ ಕೀಲು ನೋವು ನಿವಾರಿಸುತ್ತದೆ\n\nನಮ್ಮ ಬೆಲ್ಲ 100% ಸಾವಯವ ಮತ್ತು ರಾಸಾಯನಿಕ ಮುಕ್ತ!",
      ml: "🌿 ശർക്കരയുടെ ആരോഗ്യ ഗുണങ്ങൾ:\n\n✅ ഇരുമ്പ് സമൃദ്ധമാണ് - വിളർച്ച തടയുന്നു\n✅ പ്രതിരോധശേഷി വർദ്ധിപ്പിക്കുന്നു\n✅ ദഹനത്തെ സഹായിക്കുന്നു\n✅ ശരീരത്തെ ശുദ്ധീകരിക്കുന്നു\n✅ പ്രകൃതിദത്ത ഊർജ്ജ സ്രോതസ്സ്\n✅ ചർമ്മ ആരോഗ്യത്തിന് നല്ലത്\n✅ സന്ധി വേദന ശമിപ്പിക്കുന്നു\n\nഞങ്ങളുടെ ശർക്കര 100% ജൈവവും രാസവസ്തു രഹിതവുമാണ്!",
      mr: "🌿 गुळाचे आरोग्य फायदे:\n\n✅ लोहाने समृद्ध - अशक्तपणा रोखतो\n✅ रोगप्रतिकारक शक्ती वाढवतो\n✅ पचनास मदत करतो\n✅ शरीर शुद्ध करतो\n✅ नैसर्गिक ऊर्जा स्रोत\n✅ त्वचेच्या आरोग्यासाठी चांगले\n✅ सांधेदुखी कमी करतो\n\nआमचा गूळ 100% सेंद्रिय आणि रसायनमुक्त आहे!",
      bn: "🌿 গুড়ের স্বাস্থ্য উপকারিতা:\n\n✅ লোহা সমৃদ্ধ - রক্তাল্পতা প্রতিরোধ করে\n✅ রোগ প্রতিরোধ ক্ষমতা বাড়ায়\n✅ হজমে সাহায্য করে\n✅ শরীর পরিষ্কার করে\n✅ প্রাকৃতিক শক্তির উৎস\n✅ ত্বকের স্বাস্থ্যের জন্য ভাল\n✅ জয়েন্টের ব্যথা উপশম করে\n\nআমাদের গুড় 100% জৈব এবং রাসায়নিক মুক্ত!",
      gu: "🌿 ગોળના આરોગ્ય લાભ:\n\n✅ લોહથી સમૃદ્ધ - એનિમિયા અટકાવે છે\n✅ રોગપ્રતિકારક શક્તિ વધારે છે\n✅ પાચનમાં મદદ કરે છે\n✅ શરીરને શુદ્ધ કરે છે\n✅ કુદરતી ઊર્જા સ્ત્રોત\n✅ ત્વચા સ્વાસ્થ્ય માટે સારું\n✅ સાંધાના દુખાવા દૂર કરે છે\n\nઅમારો ગોળ 100% કાર્બનિક અને રસાયણ મુક્ત છે!",
      pa: "🌿 ਗੁੜ ਦੇ ਸਿਹਤ ਲਾਭ:\n\n✅ ਆਇਰਨ ਨਾਲ ਭਰਪੂਰ - ਅਨੀਮੀਆ ਰੋਕਦਾ ਹੈ\n✅ ਰੋਗ ਪ੍ਰਤੀਰੋਧਕ ਸ਼ਕਤੀ ਵਧਾਉਂਦਾ ਹੈ\n✅ ਪਾਚਨ ਵਿੱਚ ਮਦਦ ਕਰਦਾ ਹੈ\n✅ ਸਰੀਰ ਨੂੰ ਸਾਫ਼ ਕਰਦਾ ਹੈ\n✅ ਕੁਦਰਤੀ ਊਰਜਾ ਸਰੋਤ\n✅ ਚਮੜੀ ਦੀ ਸਿਹਤ ਲਈ ਚੰਗਾ\n✅ ਜੋੜਾਂ ਦੇ ਦਰਦ ਨੂੰ ਘਟਾਉਂਦਾ ਹੈ\n\nਸਾਡਾ ਗੁੜ 100% ਜੈਵਿਕ ਅਤੇ ਰਸਾਇਣ ਮੁਕਤ ਹੈ!"
    };
    return {
      message: healthMessages[language] || healthMessages.en,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('track') || msgLower.includes('order') || msgLower.includes('status') ||
      msgLower.includes('கண்காணி') || msgLower.includes('ஆர்டர்') || msgLower.includes('ट्रैक') || 
      msgLower.includes('ऑर्डर') || msgLower.includes('ట్రాక్')) {
    const trackMessages = {
      en: "To track your order:\n\n1. Log in to your account\n2. Go to 'My Orders' section\n3. Click on the order you want to track\n\nYou can also contact our support team:\n📞 Phone: +91 9876543210\n💬 WhatsApp: +91 9876543210",
      hi: "अपने ऑर्डर को ट्रैक करने के लिए:\n\n1. अपने खाते में लॉग इन करें\n2. 'मेरे ऑर्डर' अनुभाग पर जाएं\n3. उस ऑर्डर पर क्लिक करें जिसे आप ट्रैक करना चाहते हैं\n\nआप हमारी सहायता टीम से भी संपर्क कर सकते हैं:\n📞 फोन: +91 9876543210\n💬 WhatsApp: +91 9876543210",
      ta: "உங்கள் ஆர்டரை கண்காணிக்க:\n\n1. உங்கள் கணக்கில் உள்நுழையவும்\n2. 'எனது ஆர்டர்கள்' பிரிவுக்குச் செல்லவும்\n3. நீங்கள் கண்காணிக்க விரும்பும் ஆர்டரில் கிளிக் செய்யவும்\n\nநீங்கள் எங்கள் ஆதரவு குழுவையும் தொடர்பு கொள்ளலாம்:\n📞 தொலைபேசி: +91 9876543210\n💬 WhatsApp: +91 9876543210",
      te: "మీ ఆర్డర్‌ను ట్రాక్ చేయడానికి:\n\n1. మీ ఖాతాలోకి లాగిన్ అవ్వండి\n2. 'నా ఆర్డర్లు' విభాగానికి వెళ్లండి\n3. మీరు ట్రాక్ చేయాలనుకుంటున్న ఆర్డర్‌పై క్లిక్ చేయండి\n\nమీరు మా మద్దతు బృందాన్ని కూడా సంప్రదించవచ్చు:\n📞 ఫోన్: +91 9876543210\n💬 WhatsApp: +91 9876543210",
      kn: "ನಿಮ್ಮ ಆರ್ಡರ್ ಅನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಲು:\n\n1. ನಿಮ್ಮ ಖಾತೆಗೆ ಲಾಗ್ ಇನ್ ಮಾಡಿ\n2. 'ನನ್ನ ಆರ್ಡರ್‌ಗಳು' ವಿಭಾಗಕ್ಕೆ ಹೋಗಿ\n3. ನೀವು ಟ್ರ್ಯಾಕ್ ಮಾಡಲು ಬಯಸುವ ಆರ್ಡರ್ ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ\n\nನೀವು ನಮ್ಮ ಬೆಂಬಲ ತಂಡವನ್ನು ಸಹ ಸಂಪರ್ಕಿಸಬಹುದು:\n📞 ಫೋನ್: +91 9876543210\n💬 WhatsApp: +91 9876543210",
      ml: "നിങ്ങളുടെ ഓർഡർ ട്രാക്ക് ചെയ്യാൻ:\n\n1. നിങ്ങളുടെ അക്കൗണ്ടിലേക്ക് ലോഗിൻ ചെയ്യുക\n2. 'എന്റെ ഓർഡറുകൾ' വിഭാഗത്തിലേക്ക് പോകുക\n3. നിങ്ങൾ ട്രാക്ക് ചെയ്യാൻ ആഗ്രഹിക്കുന്ന ഓർഡറിൽ ക്ലിക്ക് ചെയ്യുക\n\nനിങ്ങൾക്ക് ഞങ്ങളുടെ പിന്തുണാ ടീമിനെയും ബന്ധപ്പെടാം:\n📞 ഫോൺ: +91 9876543210\n💬 WhatsApp: +91 9876543210"
    };
    return {
      message: trackMessages[language] || trackMessages.en,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  if (msgLower.includes('contact') || msgLower.includes('support')) {
    const contactMsg = language === 'en'
      ? `You can reach us at:\n📞 Phone: ${t.contact.phone}\n📧 Email: ${t.contact.email}\n💬 WhatsApp: ${t.contact.whatsapp}\n⏰ ${t.contact.hours}`
      : `${t.contact.phone}\n${t.contact.email}\n${t.contact.whatsapp}\n${t.contact.hours}`;
    return {
      message: contactMsg,
      quickReplies: generateQuickReplies(message, language)
    };
  }

  // Default response for unrecognized messages
  const defaultResponses = {
    en: "I'd be happy to help you! I can assist with:\n\n🛍️ Product information\n📦 Shipping and delivery\n📱 Order tracking\n💳 Payment options\n🔄 Returns and refunds\n📞 Contact support\n\nWhat would you like to know more about?",
    hi: "मैं आपकी मदद करने के लिए तैयार हूं! मैं इसमें सहायता कर सकता हूं:\n\n🛍️ उत्पाद जानकारी\n📦 शिपिंग और डिलीवरी\n📱 ऑर्डर ट्रैकिंग\n💳 भुगतान विकल्प\n🔄 रिटर्न और रिफंड\n📞 सहायता से संपर्क करें\n\nआप किसके बारे में अधिक जानना चाहेंगे?",
    ta: "நான் உங்களுக்கு உதவ மகிழ்ச்சியாக இருக்கிறேன்! நான் இவற்றில் உதவ முடியும்:\n\n🛍️ தயாரிப்பு தகவல்\n📦 ஷிப்பிங் மற்றும் டெலிவரி\n📱 ஆர்டர் கண்காணிப்பு\n💳 பணம் செலுத்தும் விருப்பங்கள்\n🔄 திரும்பப் பெறுதல் மற்றும் பணத்திருப்பி\n📞 ஆதரவைத் தொடர்பு கொள்ளுங்கள்\n\nநீங்கள் எதைப் பற்றி மேலும் அறிய விரும்புகிறீர்கள்?",
    te: "నేను మీకు సహాయం చేయడానికి సంతోషిస్తున్నాను! నేను వీటిలో సహాయం చేయగలను:\n\n🛍️ ఉత్పత్తి సమాచారం\n📦 షిప్పింగ్ మరియు డెలివరీ\n📱 ఆర్డర్ ట్రాకింగ్\n💳 చెల్లింపు ఎంపికలు\n🔄 రిటర్న్స్ మరియు రీఫండ్స్\n📞 మద్దతును సంప్రదించండి\n\nమీరు దేని గురించి మరింత తెలుసుకోవాలనుకుంటున్నారు?",
    kn: "ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ಸಂತೋಷಪಡುತ್ತೇನೆ! ನಾನು ಇವುಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ:\n\n🛍️ ಉತ್ಪನ್ನ ಮಾಹಿತಿ\n📦 ಶಿಪ್ಪಿಂಗ್ ಮತ್ತು ಡೆಲಿವರಿ\n📱 ಆರ್ಡರ್ ಟ್ರ್ಯಾಕಿಂಗ್\n💳 ಪಾವತಿ ಆಯ್ಕೆಗಳು\n🔄 ರಿಟರ್ನ್ಸ್ ಮತ್ತು ರೀಫಂಡ್ಸ್\n📞 ಬೆಂಬಲವನ್ನು ಸಂಪರ್ಕಿಸಿ\n\nನೀವು ಯಾವುದರ ಬಗ್ಗೆ ಹೆಚ್ಚು ತಿಳಿಯಲು ಬಯಸುತ್ತೀರಿ?",
    ml: "നിങ്ങളെ സഹായിക്കാൻ എനിക്ക് സന്തോഷമുണ്ട്! എനിക്ക് ഇവയിൽ സഹായിക്കാൻ കഴിയും:\n\n🛍️ ഉൽപ്പന്ന വിവരങ്ങൾ\n📦 ഷിപ്പിംഗും ഡെലിവറിയും\n📱 ഓർഡർ ട്രാക്കിംഗ്\n💳 പേയ്മെന്റ് ഓപ്ഷനുകൾ\n🔄 റിട്ടേണുകളും റീഫണ്ടുകളും\n📞 പിന്തുണയുമായി ബന്ധപ്പെടുക\n\nനിങ്ങൾക്ക് എന്താണ് കൂടുതൽ അറിയേണ്ടത്?",
    mr: "मी तुम्हाला मदत करण्यास आनंदित आहे! मी यामध्ये मदत करू शकतो:\n\n🛍️ उत्पादन माहिती\n📦 शिपिंग आणि डिलिव्हरी\n📱 ऑर्डर ट्रॅकिंग\n💳 पेमेंट पर्याय\n🔄 परतावा आणि परतावा\n📞 समर्थनाशी संपर्क साधा\n\nतुम्हाला याबद्दल अधिक काय जाणून घ्यायचे आहे?",
    bn: "আমি আপনাকে সাহায্য করতে পেরে খুশি! আমি এতে সাহায্য করতে পারি:\n\n🛍️ পণ্যের তথ্য\n📦 শিপিং এবং ডেলিভারি\n📱 অর্ডার ট্র্যাকিং\n💳 পেমেন্ট বিকল্প\n🔄 রিটার্ন এবং রিফান্ড\n📞 সাপোর্টের সাথে যোগাযোগ করুন\n\nআপনি কী সম্পর্কে আরও জানতে চান?",
    gu: "હું તમને મદદ કરીને ખુશ છું! હું આમાં મદદ કરી શકું છું:\n\n🛍️ ઉત્પાદન માહિતી\n📦 શિપિંગ અને ડિલિવરી\n📱 ઓર્ડર ટ્રેકિંગ\n💳 ચુકવણી વિકલ્પો\n🔄 રિટર્ન અને રિફંડ\n📞 સપોર્ટનો સંપર્ક કરો\n\nતમે શું વધુ જાણવા માંગો છો?",
    pa: "ਮੈਂ ਤੁਹਾਡੀ ਮਦਦ ਕਰਨ ਲਈ ਖੁਸ਼ ਹਾਂ! ਮੈਂ ਇਸ ਵਿੱਚ ਮਦਦ ਕਰ ਸਕਦਾ ਹਾਂ:\n\n🛍️ ਉਤਪਾਦ ਜਾਣਕਾਰੀ\n📦 ਸ਼ਿਪਿੰਗ ਅਤੇ ਡਿਲੀਵਰੀ\n📱 ਆਰਡਰ ਟਰੈਕਿੰਗ\n💳 ਭੁਗਤਾਨ ਵਿਕਲਪ\n🔄 ਵਾਪਸੀ ਅਤੇ ਰਿਫੰਡ\n📞 ਸਹਾਇਤਾ ਨਾਲ ਸੰਪਰਕ ਕਰੋ\n\nਤੁਸੀਂ ਕਿਸ ਬਾਰੇ ਹੋਰ ਜਾਣਨਾ ਚਾਹੁੰਦੇ ਹੋ?"
  };
  
  return {
    message: defaultResponses[language] || defaultResponses.en,
    quickReplies: generateQuickReplies(message, language)
  };
}

// ==================== CHATBOT ROUTES ====================

app.post('/api/chatbot/message', async (req, res) => {
  try {
    const { message, userId, language = 'en', conversationHistory = [] } = req.body;
    
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ 
        message: 'Message is required and must be a non-empty string',
        quickReplies: []
      });
    }

    const supportedLanguages = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'es', 'fr', 'de', 'ar'];
    const lang = supportedLanguages.includes(language) ? language : 'en';

    if (!GROQ_API_KEY || GROQ_API_KEY.trim() === '') {
      console.log('⚠️ GROQ_API_KEY not configured. Using fallback responses.');
      const fallbackResponse = generateFallbackResponse(message, lang);
      return res.json(fallbackResponse);
    }

    try {
      const systemPrompt = await buildSystemPrompt(userId, lang);

      const messages = [
        ...conversationHistory.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text
        })),
        { role: 'user', content: message }
      ];

      const aiResponse = await callGroqAPI(messages, systemPrompt);
      const quickReplies = generateQuickReplies(message, lang);

      res.json({
        message: aiResponse,
        quickReplies: quickReplies
      });

    } catch (groqError) {
      console.error('Groq API Error Details:', {
        message: groqError.message,
        response: groqError.response?.data,
        status: groqError.response?.status
      });
      
      console.log('⚠️ Groq API failed. Using fallback response.');
      const fallbackResponse = generateFallbackResponse(message, lang);
      return res.json(fallbackResponse);
    }

  } catch (error) {
    console.error('Chatbot endpoint error:', {
      message: error.message,
      stack: error.stack
    });
    
    const errorMessages = {
      en: "I'm having trouble right now. Please try again or contact our support team.",
      hi: "मुझे अभी परेशानी हो रही है। कृपया पुनः प्रयास करें या हमारी सहायता टीम से संपर्क करें।",
      ta: "எனக்கு இப்போது சிக்கல் உள்ளது. மீண்டும் முயற்சிக்கவும் அல்லது எங்கள் ஆதரவு குழுவை தொடர்பு கொள்ளவும்.",
      te: "నాకు ఇప్పుడు ఇబ్బంది ఉంది. దయచేసి మళ్లీ ప్రయత్నించండి లేదా మా మద్దతు బృందాన్ని సంప్రదించండి."
    };
    const lang = req.body.language || 'en';
    res.status(500).json({ 
      message: errorMessages[lang] || errorMessages.en,
      quickReplies: []
    });
  }
});

// Get supported languages
app.get('/api/chatbot/languages', async (req, res) => {
  try {
    res.json({
      languages: [
        // Indian Languages
        { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
        { code: 'hi', name: 'Hindi', nativeName: 'हिंदी', flag: '🇮🇳' },
        { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
        { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', flag: '🇮🇳' },
        { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', flag: '🇮🇳' },
        { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
        { code: 'mr', name: 'Marathi', nativeName: 'मराठी', flag: '🇮🇳' },
        { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇮🇳' },
        { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', flag: '🇮🇳' },
        { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', flag: '🇮🇳' },
        // International Languages
        { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
        { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
        { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
        { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦' }
      ]
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching languages' });
  }
});

// ==================== AUTH ROUTES ====================

// ── POST /api/auth/signup ──
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required' });

    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    // Check for existing user
    const [existing] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (existing) return res.status(409).json({ message: 'An account with this email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db.insert(users).values({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
    }).returning();

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error('Signup error:', error.message);
    res.status(500).json({ message: 'Error creating account. Please try again.' });
  }
});

// ── POST /api/auth/login ──
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Error logging in. Please try again.' });
  }
});

// ── GET /api/auth/me — verify token & return current user ──
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user' });
  }
});

// ── GET /api/auth/orders — get orders for logged-in user ──
app.get('/api/auth/orders', requireAuth, async (req, res) => {
  try {
    const userOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, req.user.id))
      .orderBy(desc(orders.createdAt));
    res.json({ orders: userOrders });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// ==================== ORDER ROUTES ====================

// ⚠️ PUBLIC TRACK ROUTE — must be defined BEFORE authenticated /api/orders routes
app.get('/api/orders/track/:id', async (req, res) => {
  try {
    const raw = req.params.id.toString().replace(/^#?GUDY-?0*/i, '') || req.params.id;
    const orderId = parseInt(raw, 10);
    if (isNaN(orderId)) return res.status(400).json({ message: 'Invalid order ID' });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return res.status(404).json({ message: 'Order not found. Please check your Order ID.' });

    res.json({
      order: {
        id:              order.id,
        status:          order.status || 'pending',
        createdAt:       order.createdAt,
        updatedAt:       order.updatedAt,
        totalAmount:     order.totalAmount,
        paymentMethod:   order.paymentMethod,
        items:           order.items,
        shippingAddress: order.shippingAddress,
      }
    });
  } catch (error) {
    console.error('❌ Track order error:', error.message);
    res.status(500).json({ message: 'Error fetching order. Please try again.' });
  }
});

app.post('/api/orders', optionalAuth, async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod, totalAmount } = req.body;

    // ⚡ Only await what we NEED for the response (order insert)
    const [order] = await db.insert(orders).values({
      userId: req.user?.id || null,
      items,
      shippingAddress,
      paymentMethod: paymentMethod || 'cod',
      totalAmount: totalAmount.toString(),
      status: 'confirmed',
    }).returning();

    // Send emails BEFORE responding (Vercel kills background tasks after response)
    const orderData = { ...order, items, shippingAddress, paymentMethod, totalAmount };
    const customerEmail = req.user?.email || shippingAddress?.email;

    const bgTasks = [
      sendOrderNotification(orderData),
      customerEmail ? sendOrderConfirmationToCustomer(orderData, customerEmail) : Promise.resolve()
    ];
    // Only clear cart for logged-in users
    if (req.user?.id) {
      bgTasks.push(db.delete(cartItems).where(eq(cartItems.userId, req.user.id)));
    }

    const [adminResult, customerResult] = await Promise.allSettled(bgTasks);
    if (adminResult.status === 'fulfilled') {
      console.log(`📧 Admin notification sent for order #${order.id}`);
    } else {
      console.error('⚠️ Admin email failed:', adminResult.reason?.message);
    }
    if (customerEmail) {
      if (customerResult.status === 'fulfilled') {
        console.log(`📧 Customer confirmation sent to ${customerEmail} for order #${order.id}`);
      } else {
        console.error('⚠️ Customer email failed:', customerResult.reason?.message);
      }
    }

    // ✅ Respond after emails are sent
    res.status(201).json({ message: 'Order placed', order });
  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ message: 'Order error' });
  }
});

// ==================== ADMIN MIDDLEWARE ====================

const authenticateAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ message: 'Token required' });

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.email !== 'office.gudy@gmail.com') {
      return res.status(403).json({ message: 'Admin access only' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// ==================== ADMIN ORDER ROUTES ====================

// GET all orders (admin)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const allOrders = await db.select().from(orders).orderBy(desc(orders.createdAt));
    res.json({ orders: allOrders });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// PATCH order status (admin) — also emails customer
app.patch('/api/orders/:id/status', authenticateAdmin, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return res.status(400).json({ message: 'Invalid order ID' });

    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    // NOTE: Ensure your orders schema has: status (text, default 'pending') and updatedAt (timestamp)
    const [updated] = await db
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();

    if (!updated) return res.status(404).json({ message: 'Order not found' });

    res.json({ message: 'Order status updated', order: updated });

    // Fire status-update email to customer in background
    const customerUserId = updated.userId;
    if (customerUserId) {
      db.select().from(users).where(eq(users.id, customerUserId))
        .then(([customer]) => {
          if (customer?.email) {
            sendStatusUpdateEmail(updated, customer.email).catch(err =>
              console.error('⚠️ Status email failed:', err.message)
            );
          }
        })
        .catch(err => console.error('⚠️ Could not fetch customer for status email:', err.message));
    }
  } catch (error) {
    res.status(500).json({ message: 'Error updating status' });
  }
});

// ==================== STATUS UPDATE EMAIL ====================

async function sendStatusUpdateEmail(order, customerEmail) {
  const STATUS_META = {
    confirmed:  { emoji: '✅', title: 'Order Confirmed!',    color: '#27AE60', msg: 'Your order has been verified and is being prepared.' },
    packed:     { emoji: '📦', title: 'Order Packed!',       color: '#2980B9', msg: 'Your order has been carefully packed and is ready to ship.' },
    shipped:    { emoji: '🚚', title: 'Order Shipped!',      color: '#8E44AD', msg: 'Your order is on its way! Expected delivery in 3–5 days.' },
    delivered:  { emoji: '🎉', title: 'Order Delivered!',    color: '#27AE60', msg: 'Your order has been delivered. Enjoy your GUDY products!' },
    cancelled:  { emoji: '❌', title: 'Order Cancelled',     color: '#C0392B', msg: 'Your order has been cancelled. Contact us if this was unexpected.' },
    pending:    { emoji: '🕐', title: 'Order Pending',       color: '#F39C12', msg: 'Your order is pending review.' },
  };

  const meta = STATUS_META[order.status] || STATUS_META.pending;
  const orderId = `#GUDY-${String(order.id).padStart(5, '0')}`;

  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"/></head>
    <body style="margin:0;padding:0;background:#FFF8F0;font-family:Arial,sans-serif;">
      <div style="max-width:560px;margin:30px auto;background:#fff;border-radius:16px;overflow:hidden;
                  box-shadow:0 4px 24px rgba(107,68,35,0.10);border:1px solid #f0e0cc;">

        <div style="background:linear-gradient(135deg,#2C1A0E 0%,#6B4423 100%);padding:36px 28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:8px;">${meta.emoji}</div>
          <h1 style="color:#FF9500;margin:0 0 6px;font-size:24px;">${meta.title}</h1>
          <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">GUDY Organics · Order Update</p>
        </div>

        <div style="background:#FFF3E0;padding:12px 28px;border-bottom:1px solid #f0e0cc;display:flex;
                    justify-content:space-between;align-items:center;">
          <span style="color:#7A6455;font-size:13px;">Order ID</span>
          <span style="color:#6B4423;font-weight:700;font-size:15px;">${orderId}</span>
        </div>

        <div style="padding:28px;">
          <p style="color:#2C1810;font-size:15px;margin:0 0 20px;">
            Hi there! Here's an update on your order:
          </p>

          <div style="background:${meta.color}18;border:2px solid ${meta.color}55;border-radius:12px;
                      padding:20px;text-align:center;margin-bottom:24px;">
            <div style="font-size:36px;margin-bottom:8px;">${meta.emoji}</div>
            <div style="color:${meta.color};font-size:18px;font-weight:800;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">
              ${order.status}
            </div>
            <p style="color:#2C1810;font-size:14px;margin:0;">${meta.msg}</p>
          </div>

          <div style="background:#FDF6EE;border-radius:10px;padding:16px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="color:#7A6455;font-size:13px;padding:4px 0;width:130px;">Total Amount</td>
                <td style="color:#6B4423;font-weight:700;font-size:14px;">₹${order.totalAmount}</td>
              </tr>
              <tr>
                <td style="color:#7A6455;font-size:13px;padding:4px 0;">Payment</td>
                <td style="color:#2C1810;font-weight:600;font-size:14px;text-transform:uppercase;">${order.paymentMethod}</td>
              </tr>
              ${order.shippingAddress ? `
              <tr>
                <td style="color:#7A6455;font-size:13px;padding:4px 0;">Delivering To</td>
                <td style="color:#2C1810;font-size:13px;">${order.shippingAddress.city}, ${order.shippingAddress.state}</td>
              </tr>` : ''}
            </table>
          </div>

          <div style="text-align:center;padding:16px;background:#FDF6EE;border-radius:10px;">
            <p style="color:#7A6455;font-size:13px;margin:0 0 8px;">Questions about your order?</p>
            <a href="mailto:office.gudy@gmail.com" style="color:#6B4423;font-weight:700;font-size:13px;text-decoration:none;">
              📧 office.gudy@gmail.com
            </a>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            <a href="tel:+919876543210" style="color:#6B4423;font-weight:700;font-size:13px;text-decoration:none;">
              📞 +91 9876543210
            </a>
          </div>
        </div>

        <div style="background:#2C1A0E;padding:20px;text-align:center;">
          <p style="color:#FF9500;font-size:14px;font-weight:700;margin:0 0 4px;">GUDY Organics</p>
          <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:0;">Premium Jaggery · 100% Organic · Chemical Free</p>
          <p style="color:rgba(255,255,255,0.3);font-size:10px;margin:8px 0 0;">© ${new Date().getFullYear()} GUDY Organics. All rights reserved.</p>
        </div>
      </div>
    </body></html>
  `;

  await resend.emails.send({
    from: 'GUDY Organics <onboarding@resend.dev>',
    to: customerEmail,
    subject: `${meta.emoji} ${meta.title} – ${orderId}`,
    html,
  });

  console.log(`📧 Status update email sent to ${customerEmail} for order ${orderId} → ${order.status}`);
}

app.get('/api/test-email', async (req, res) => {
  try {
    await resend.emails.send({
      from: 'GUDY Test <onboarding@resend.dev>',
      to: process.env.ADMIN_EMAIL,
      subject: 'Test Email from GUDY',
      text: 'If you see this, Resend is working!',
    });
    res.json({ success: true, message: 'Email sent!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ==================== HEALTH & START ====================

app.get('/api/health', async (req, res) => {
  try {
    const result = await sql`SELECT now()`;
    res.json({ status: 'OK', time: result[0].now });
  } catch (error) {
    res.status(500).json({ status: 'ERROR', message: error.message });
  }
});

// Frontend is hosted on Netlify — no static serving needed here

// Only listen locally — Vercel handles this in production
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 GROQ_API_KEY configured: ${GROQ_API_KEY ? 'YES ✅' : 'NO ❌ (using fallback responses)'}`);
    console.log(`🌍 Supported languages: 14 (9 Indian + 5 International)`);
  });
}

module.exports = app;