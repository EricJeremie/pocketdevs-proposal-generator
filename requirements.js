import { SUPABASE_URL, SUPABASE_ANON_KEY, getSession, signIn, signUp, signOut, onAuthChange, saveQuestionnaire, fetchSubmissionById } from './supabase.js';

const REQ_API_URL = `${SUPABASE_URL}/functions/v1/generate-requirements`;

/* ---------- DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = (items) => items && items.length
  ? `<ul class="p-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
const sectionHead = (n, title) =>
  `<div class="p-section__head"><span class="p-section__num">${String(n).padStart(2, '0')}</span><h2 class="p-section__title">${esc(title)}</h2></div>`;

/* ---------- Questions & Steps ---------- */
const Q = {
  // Contact
  contactName:    { label: 'Your full name', type: 'text', required: true, placeholder: 'e.g. Juan dela Cruz' },
  contactCompany: { label: 'Company or organization name', type: 'text', placeholder: 'e.g. Acme Trading Corp' },
  contactEmail:   { label: 'Your email address', type: 'email', placeholder: 'you@company.com' },
  contactIndustry: {
    label: 'What industry are you in?', type: 'text', placeholder: 'e.g. Retail, Healthcare, Logistics, Food & Beverage',
    help: 'This helps us understand your business context and recommend the right solutions.',
  },

  // Project
  projectType: {
    label: 'What type of digital product do you need built?', type: 'radio', required: true,
    options: [
      { value: 'website',  label: 'Website',              hint: 'Company profile, e-commerce store, portfolio, landing page, or blog' },
      { value: 'webapp',   label: 'Web Application',      hint: 'A browser-based tool with user accounts — think dashboards, booking systems, online platforms' },
      { value: 'mobile',   label: 'Mobile App',           hint: 'An app your customers download on their iPhone or Android phone' },
      { value: 'software', label: 'Custom Software',      hint: 'Internal business tool, desktop program, automation, POS system, or back-end system' },
    ],
  },
  projectName:        { label: 'Project name or working title', type: 'text', placeholder: 'e.g. ShopMate, EcoTrack, Acme POS (can be anything for now)' },
  projectDescription: {
    label: 'Describe your project in 2–3 sentences', type: 'textarea', required: true,
    placeholder: 'e.g. An online store where customers can browse our clothing catalog, place orders, and pay via GCash or credit card.',
    help: 'Just describe it in plain words — no technical jargon needed.',
  },
  projectProblem: {
    label: 'What problem does this solve for you or your customers?', type: 'textarea',
    placeholder: 'e.g. Right now we handle orders manually through Facebook Messenger which causes delays and missed orders.',
    help: 'Understanding the "why" helps us build something that truly fixes the issue, not just a generic solution.',
  },

  // Website
  websiteType: {
    label: 'What kind of website is this?', type: 'radio',
    options: [
      { value: 'company',   label: 'Company / Business profile', hint: 'Showcases who you are, your services, and lets people contact you' },
      { value: 'ecommerce', label: 'Online store',               hint: 'Customers can browse products, add to cart, and pay online' },
      { value: 'portfolio', label: 'Portfolio / Showcase',       hint: 'Displays your work, projects, or creative output' },
      { value: 'blog',      label: 'Blog / News site',           hint: 'Regularly updated articles, announcements, or media content' },
      { value: 'landing',   label: 'Landing / Marketing page',   hint: 'Single page to promote a product or collect leads' },
      { value: 'other',     label: 'Something else',             hint: 'Describe it in the project description field' },
    ],
  },
  websitePages: {
    label: 'Roughly how many pages do you need?', type: 'text', placeholder: 'e.g. 6 pages (Home, About, Services, Team, Blog, Contact)',
    help: 'More pages generally means more time and cost. Common pages: Home, About, Services/Products, Portfolio, Contact.',
  },
  websiteCMS: {
    label: 'Do you want to update the website content yourself?', type: 'radio',
    help: 'A CMS (Content Management System) is like a control panel for your website — it lets your team add blog posts, update prices, or change photos without needing a developer each time. Think of it like editing a Google Doc for your website.',
    options: [
      { value: 'yes',    label: 'Yes — we\'ll update it regularly',        hint: 'Blog posts, products, team members, etc.' },
      { value: 'no',     label: 'No — content stays mostly the same',      hint: 'We\'ll update it for you when needed' },
      { value: 'unsure', label: 'Not sure yet' },
    ],
  },
  websiteDesign: {
    label: 'Do you have a brand identity ready?', type: 'radio',
    help: 'Brand identity includes your logo, colors (e.g. blue and white), and fonts. If you already have these, we can match the website to your existing look.',
    options: [
      { value: 'yes',     label: 'Yes — logo, colors, and fonts are ready' },
      { value: 'partial', label: 'Partial — I have a logo but nothing else' },
      { value: 'no',      label: 'No — I need a complete brand and design' },
    ],
  },
  websiteFeatures: {
    label: 'Which features do you need on the website? (select all that apply)', type: 'checkboxes',
    help: 'Don\'t worry if you\'re unsure about some — just pick what sounds relevant. We\'ll confirm everything during our call.',
    options: ['Contact Form', 'Image / Product Gallery', 'Customer Testimonials', 'Newsletter Signup (email list)', 'Blog / Articles section', 'Online Booking / Scheduling', 'Live Chat', 'Social Media Feed', 'Google Maps / Location', 'Multiple languages', 'Video section', 'Customer login / Member portal', 'Product catalog', 'Online payments / Checkout'],
  },
  websiteIntegrations: {
    label: 'Any tools or platforms to connect with the website?', type: 'textarea',
    placeholder: 'e.g. Facebook Pixel, Google Analytics, Lazada/Shopee feed, GCash/PayMongo, Mailchimp, WhatsApp button',
    help: 'Integrations connect your website to other tools you already use. If unsure, just list the tools your business uses and we\'ll figure it out.',
  },

  // Web App
  webappFeatures: {
    label: 'List the main things users should be able to do in this app', type: 'textarea', required: true,
    placeholder: 'e.g.\n- Customers can register and create a profile\n- Browse and filter a product catalog\n- Place and track orders\n- Admin can view all orders and update status\n- Generate sales reports',
    help: 'Think of every action a user can take — from signing up to completing their main task. List as many as you can; we\'ll organize them for you.',
  },
  webappAuth: {
    label: 'Do users need to create an account and log in?', type: 'radio',
    help: 'Authentication (login) lets you know who each user is. This is needed if different users should see different data, or if there\'s sensitive information to protect.',
    options: [
      { value: 'yes',    label: 'Yes — users have their own accounts',   hint: 'Customers, members, or users each log in to their own space' },
      { value: 'public', label: 'No — anyone can use it without logging in', hint: 'Like a public directory or read-only dashboard' },
      { value: 'admin',  label: 'Only staff/admins log in',              hint: 'It\'s an internal tool — customers don\'t need accounts' },
    ],
  },
  webappRoles: {
    label: 'What user roles or permission levels do you need?', type: 'text',
    placeholder: 'e.g. Super Admin, Store Manager, Cashier, Customer',
    help: 'Roles control what each type of user can see or do. Example: a Cashier can process sales but can\'t delete records; a Manager can view reports.',
  },
  webappAdmin: {
    label: 'Do you need an admin dashboard to manage the system?', type: 'radio',
    help: 'An admin dashboard is a private area where you or your team can manage users, view data, run reports, and control settings — like a back-office for the system.',
    options: [
      { value: 'yes',    label: 'Yes — we need a full admin area' },
      { value: 'no',     label: 'No — just the main user-facing app' },
      { value: 'unsure', label: 'Not sure yet' },
    ],
  },
  webappPayments: {
    label: 'Will users need to pay online?', type: 'radio',
    help: 'Payment integration connects the app to payment services like GCash, PayMongo, Maya, or credit cards so users can pay directly without leaving the app.',
    options: [
      { value: 'yes',    label: 'Yes — online payments are needed',        hint: 'GCash, Maya, credit/debit card, bank transfer' },
      { value: 'no',     label: 'No — no payment processing needed' },
      { value: 'future', label: 'Not now, but we might add it later' },
    ],
  },
  webappRealtime: {
    label: 'Do you need any real-time features? (select all that apply)', type: 'checkboxes',
    help: 'Real-time features update automatically without refreshing the page. Example: a customer sees their order status change live, or a chat message appears instantly.',
    options: ['Live notifications (e.g. new order alert)', 'Real-time chat / messaging', 'Live dashboard / data that auto-updates', 'Video or voice calls', 'None of the above'],
  },
  webappIntegrations: {
    label: 'Does this app need to connect with other services?', type: 'textarea',
    placeholder: 'e.g. PayMongo for payments, SendGrid for emails, Twilio for SMS, Google Maps, government APIs, existing POS system',
    help: 'Integrations are connections to outside tools and services. If you send emails, SMS, or accept payments, those are integrations.',
  },
  webappData: {
    label: 'Do you have existing data that needs to be imported?', type: 'radio',
    help: 'If you currently use spreadsheets, another software, or a manual system with existing records (customers, inventory, etc.), we may need to transfer that data into the new system.',
    options: [
      { value: 'yes', label: 'Yes — we have data to migrate (spreadsheets, old system, etc.)' },
      { value: 'no',  label: 'No — we\'re starting fresh with no existing data' },
    ],
  },

  // Mobile
  mobilePlatform: {
    label: 'Which phones should the app work on?', type: 'radio',
    options: [
      { value: 'ios',     label: 'iPhone / iPad only (iOS)' },
      { value: 'android', label: 'Android only' },
      { value: 'both',    label: 'Both iPhone and Android', hint: 'Recommended for maximum reach' },
    ],
  },
  mobileTech: {
    label: 'Technology preference?', type: 'radio',
    help: 'Don\'t worry about the technical details — here\'s a simple explanation: Cross-platform means we build one codebase that works on both iPhone and Android (more cost-effective). Native means we build two separate apps, one for each platform (maximum performance but higher cost).',
    options: [
      { value: 'crossplatform', label: 'Cross-platform (React Native / Flutter)', hint: 'One codebase for both iOS and Android — more affordable, faster to build' },
      { value: 'native',        label: 'Native (Swift for iOS, Kotlin for Android)', hint: 'Built separately for each platform — best performance, higher cost' },
      { value: 'nopref',        label: 'No preference — recommend what\'s best', hint: 'We\'ll advise based on your budget and needs' },
    ],
  },
  mobileCategory: {
    label: 'What category best describes this app?', type: 'select',
    options: ['Productivity / Business tool', 'Shopping / E-commerce', 'Social / Community', 'Finance / Banking / Payments', 'Health / Fitness / Wellness', 'Food / Restaurant / Delivery', 'Education / E-learning', 'Entertainment / Media', 'Travel / Hospitality', 'Real Estate', 'Logistics / Delivery / Tracking', 'Other'],
  },
  mobileFeatures: {
    label: 'What are the main things a user can do in the app?', type: 'textarea', required: true,
    placeholder: 'e.g.\n- Browse and search products\n- Add to cart and check out with GCash\n- Track order status\n- View order history\n- Contact support via chat',
    help: 'Describe it like you\'re explaining the app to a friend. What would you tap on first? Then what?',
  },
  mobileSpecial: {
    label: 'Does the app need any special phone features? (select all that apply)', type: 'checkboxes',
    help: 'Modern phones have built-in features (camera, GPS, etc.) that apps can use. Select only what your app genuinely needs.',
    options: ['Push Notifications (alerts even when app is closed)', 'GPS / Maps (show location or give directions)', 'Camera (take photos or scan)', 'Works offline (no internet needed for some features)', 'In-App Purchases or subscriptions', 'QR Code Scanner', 'Face ID / Fingerprint login', 'Bluetooth / NFC', 'None of the above'],
  },
  mobileAppStore: {
    label: 'Do you need help publishing to the App Store / Play Store?', type: 'radio',
    help: 'Before users can download your app, it needs to be reviewed and approved by Apple (App Store) and Google (Play Store). This process can take 1–4 weeks and requires developer accounts.',
    options: [
      { value: 'yes',    label: 'Yes — handle the submission for us' },
      { value: 'no',     label: 'No — our team will handle the publishing' },
      { value: 'unsure', label: 'Not sure yet' },
    ],
  },

  // Custom Software
  softwareType: {
    label: 'What kind of software or system do you need?', type: 'select',
    help: 'Custom software is any system built specifically for your business\'s unique processes — not an off-the-shelf product.',
    options: ['Desktop Application (runs on a computer, not a browser)', 'Backend API / Service (powers other apps or integrations)', 'Data Processing / Reporting pipeline', 'Business Automation (replaces manual repetitive tasks)', 'Internal Business Tool / ERP (inventory, HR, operations)', 'Point of Sale (POS) System', 'Other'],
  },
  softwareEnvironment: {
    label: 'Where will this software run?', type: 'checkboxes',
    options: ['Windows computers', 'Mac computers', 'Linux servers', 'Cloud / Internet server', 'Inside a web browser (web-based)', 'Other'],
  },
  softwareUsers: {
    label: 'How many people will use this system?', type: 'text', placeholder: 'e.g. 5 employees, 2 branches, 500 customers per day',
    help: 'This helps us size the system correctly. Even a rough estimate is fine.',
  },
  softwarePerformance: {
    label: 'Any speed or capacity requirements?', type: 'textarea',
    placeholder: 'e.g. Must process 500 transactions per day; reports should generate in under 5 seconds; must support 10 users simultaneously',
    help: 'Performance requirements help us choose the right architecture. If you\'re unsure, just describe the busiest scenario you can imagine.',
  },
  softwareSecurity: {
    label: 'Security or compliance requirements?', type: 'checkboxes',
    help: 'Some industries have legal requirements for how data is stored and protected. If your business handles medical records, financial data, or personal information of EU citizens, there may be specific rules to follow.',
    options: ['Standard security (password protection, encrypted data)', 'GDPR (you handle data of people in Europe)', 'HIPAA (you handle medical / health records)', 'PCI-DSS (you process credit/debit card payments)', 'None of the above / Unsure'],
  },
  softwareIntegrations: {
    label: 'Does this system need to connect with other tools or platforms?', type: 'textarea',
    placeholder: 'e.g. QuickBooks for accounting, our existing POS, government BIR eFPS, SMS provider, email service',
    help: 'Integrations allow the new system to exchange data with tools your business already uses.',
  },

  // Users & Audience
  targetUsers: {
    label: 'Who are the people who will use this?', type: 'textarea', required: true,
    placeholder: 'e.g. Small business owners in the Philippines aged 25–45 who currently manage their inventory in spreadsheets and want something simpler.',
    help: 'The more specific you are, the better we can design for them. Think: who is the typical user, what do they know, and what\'s their main goal?',
  },
  userCount: {
    label: 'How many users do you expect?', type: 'select',
    help: 'This is just an estimate — it helps us design the right infrastructure. A system for 50 internal staff needs different planning than one for 50,000 customers.',
    options: ['Under 100 (small team or pilot)', '100 – 1,000', '1,000 – 10,000', '10,000 – 100,000', 'Over 100,000', 'Not sure yet'],
  },
  devices: {
    label: 'What devices will your users mainly use?', type: 'checkboxes',
    help: 'This determines how much effort goes into mobile design. If most of your users are on phones, we\'ll prioritize a mobile-friendly layout.',
    options: ['Desktop or laptop computer', 'Mobile phone', 'Tablet', 'Mix of all the above'],
  },

  // Timeline & Budget
  targetDate: {
    label: 'When do you need this ready?', type: 'text', placeholder: 'e.g. December 2026, within 3 months, before the holiday season',
    help: 'A rough timeframe is fine. If there\'s a specific event or deadline driving this (e.g. a product launch, a trade show), mention it.',
  },
  flexibleTimeline: {
    label: 'Is this deadline firm?', type: 'radio',
    options: [
      { value: 'yes',    label: 'Yes — somewhat flexible',    hint: 'Preferred date but can adjust' },
      { value: 'no',     label: 'No — hard deadline',          hint: 'There\'s a specific event or contract date' },
      { value: 'unsure', label: 'No specific deadline yet' },
    ],
  },
  budgetRange: {
    label: 'What\'s your approximate budget? (in Philippine Pesos)', type: 'radio',
    help: 'We understand this can be a sensitive question. Sharing a range helps us recommend the right scope and approach so we don\'t waste each other\'s time. All information is confidential.',
    options: [
      { value: 'under50k',  label: 'Under ₱50,000',               hint: 'Best for simple landing pages or very limited features' },
      { value: '50k-150k',  label: '₱50,000 – ₱150,000',          hint: 'Suitable for small websites or basic apps' },
      { value: '150k-300k', label: '₱150,000 – ₱300,000',         hint: 'Covers most mid-range websites and apps' },
      { value: '300k-500k', label: '₱300,000 – ₱500,000',         hint: 'For complex web apps with multiple features' },
      { value: '500k-1m',   label: '₱500,000 – ₱1,000,000',       hint: 'Large-scale platforms and enterprise systems' },
      { value: 'over1m',    label: 'Over ₱1,000,000',              hint: 'Enterprise-grade systems or full product development' },
      { value: 'discuss',   label: 'Prefer to discuss in the call', hint: 'That\'s fine — we\'ll figure it out together' },
    ],
  },
  hasExisting: {
    label: 'Do you currently have an existing website or system?', type: 'radio',
    options: [
      { value: 'current',  label: 'Yes — and it\'s working fine',           hint: 'We\'re enhancing or replacing it' },
      { value: 'outdated', label: 'Yes — but it\'s outdated or broken',     hint: 'Needs a refresh or full rebuild' },
      { value: 'none',     label: 'No — we\'re starting from zero' },
    ],
  },

  // Additional
  references: {
    label: 'Any websites or apps that inspire you?', type: 'textarea',
    placeholder: 'e.g. I like how Grab has a simple tracking screen. The dashboard on Shopify is clean. Lazada\'s product page is a good reference.',
    help: 'You don\'t need links — just describe what you like about them. This helps us understand your taste and expectations.',
  },
  techPreferences: {
    label: 'Any technical preferences or constraints?', type: 'textarea',
    placeholder: 'e.g. Must be hosted locally in the Philippines, must work with our existing Microsoft 365 setup, prefer open-source tools',
    help: 'Leave blank if you have no specific requirements. We\'ll choose the best technology stack for your needs.',
  },
  mustHave: {
    label: 'What\'s the single most important thing this project must nail?', type: 'textarea',
    placeholder: 'e.g. It must be so simple that my 60-year-old staff can use it without training.',
    help: 'If we can only get one thing absolutely right, what would it be? This becomes our North Star when making design decisions.',
  },
  additionalNotes: {
    label: 'Anything else you\'d like to share?', type: 'textarea',
    placeholder: 'Any context, concerns, past experiences with developers, or things you want us to be aware of.',
    help: 'This is your space to add anything that didn\'t fit the previous questions.',
  },
};

const STEPS = [
  { id: 'contact',  title: 'About You',         questions: ['contactName', 'contactCompany', 'contactEmail', 'contactIndustry'] },
  { id: 'project',  title: 'Your Project',       questions: ['projectType', 'projectName', 'projectDescription', 'projectProblem'] },
  { id: 'website',  title: 'Website Details',    questions: ['websiteType', 'websitePages', 'websiteCMS', 'websiteDesign', 'websiteFeatures', 'websiteIntegrations'], when: (a) => a.projectType === 'website' },
  { id: 'webapp',   title: 'Web App Details',    questions: ['webappFeatures', 'webappAuth', 'webappRoles', 'webappAdmin', 'webappPayments', 'webappRealtime', 'webappIntegrations', 'webappData'], when: (a) => a.projectType === 'webapp' },
  { id: 'mobile',   title: 'Mobile App Details', questions: ['mobilePlatform', 'mobileTech', 'mobileCategory', 'mobileFeatures', 'mobileSpecial', 'mobileAppStore'], when: (a) => a.projectType === 'mobile' },
  { id: 'software', title: 'Software Details',   questions: ['softwareType', 'softwareEnvironment', 'softwareUsers', 'softwarePerformance', 'softwareSecurity', 'softwareIntegrations'], when: (a) => a.projectType === 'software' },
  { id: 'users',    title: 'Users & Audience',   questions: ['targetUsers', 'userCount', 'devices'] },
  { id: 'timeline', title: 'Timeline & Budget',  questions: ['targetDate', 'flexibleTimeline', 'budgetRange', 'hasExisting'] },
  { id: 'extra',    title: 'Additional Info',     questions: ['references', 'techPreferences', 'mustHave', 'additionalNotes'] },
];

/* ---------- State ---------- */
let answers = {};
let currentStep = 0;
let isShareMode = false;
let currentSubmissionId = null;

function getActiveSteps() {
  return STEPS.filter((s) => !s.when || s.when(answers));
}

/* ---------- Render step ---------- */
function renderQuestion(qid, value) {
  const q = Q[qid];
  if (!q) return '';
  const val = value != null ? value : '';
  const id = `rq_${qid}`;

  const helpHtml = q.help ? `<p class="rq-field-help">${q.help.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>` : '';

  if (q.type === 'text' || q.type === 'email') {
    return `<div class="field">
      <label class="label" for="${id}">${esc(q.label)}${q.required ? ' <span class="label__req">*</span>' : ''}</label>
      ${helpHtml}
      <input id="${id}" name="${qid}" class="input" type="${q.type}" placeholder="${esc(q.placeholder || '')}" value="${esc(val)}" ${q.required ? 'required' : ''} />
    </div>`;
  }

  if (q.type === 'textarea') {
    return `<div class="field">
      <label class="label" for="${id}">${esc(q.label)}${q.required ? ' <span class="label__req">*</span>' : ''}</label>
      ${helpHtml}
      <textarea id="${id}" name="${qid}" class="input textarea" rows="4" placeholder="${esc(q.placeholder || '')}" ${q.required ? 'required' : ''}>${esc(val)}</textarea>
    </div>`;
  }

  if (q.type === 'select') {
    const opts = q.options.map((o) => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('');
    return `<div class="field">
      <label class="label" for="${id}">${esc(q.label)}</label>
      ${helpHtml}
      <select id="${id}" name="${qid}" class="input"><option value="">Select…</option>${opts}</select>
    </div>`;
  }

  if (q.type === 'radio') {
    const cards = q.options.map((o) => {
      const checked = val === o.value ? 'checked' : '';
      return `<label class="rq-choice ${checked ? 'rq-choice--checked' : ''}">
        <input type="radio" name="${qid}" value="${esc(o.value)}" ${checked} class="rq-choice__input" />
        <span class="rq-choice__label">${esc(o.label)}</span>
        ${o.hint ? `<span class="rq-choice__hint">${esc(o.hint)}</span>` : ''}
      </label>`;
    }).join('');
    return `<div class="field">
      <label class="label">${esc(q.label)}${q.required ? ' <span class="label__req">*</span>' : ''}</label>
      ${helpHtml}
      <div class="rq-choices" data-qid="${qid}">${cards}</div>
    </div>`;
  }

  if (q.type === 'checkboxes') {
    const checked = Array.isArray(val) ? val : [];
    const boxes = q.options.map((o) => {
      const isChecked = checked.includes(o) ? 'checked' : '';
      return `<label class="rq-check ${isChecked ? 'rq-check--checked' : ''}">
        <input type="checkbox" name="${qid}" value="${esc(o)}" ${isChecked} class="rq-check__input" />
        <span class="rq-check__label">${esc(o)}</span>
      </label>`;
    }).join('');
    return `<div class="field">
      <label class="label">${esc(q.label)}</label>
      ${helpHtml}
      <div class="rq-checks" data-qid="${qid}">${boxes}</div>
    </div>`;
  }

  return '';
}

function renderStep() {
  const active = getActiveSteps();
  const step = active[currentStep];
  if (!step) return;

  $('rqStepContent').innerHTML = `
    <h2 class="rq-step__title">${esc(step.title)}</h2>
    ${step.questions.map((qid) => renderQuestion(qid, answers[qid])).join('')}
  `;

  const progress = ((currentStep) / active.length) * 100;
  $('rqProgressBar').style.width = `${progress}%`;
  $('rqStepLabel').textContent = `Step ${currentStep + 1} of ${active.length}`;
  $('rqBackBtn').hidden = currentStep === 0;
  $('rqNextBtn').textContent = currentStep === active.length - 1 ? 'Review answers' : 'Next';

  // Wire radio choice highlight
  $('rqStepCard').querySelectorAll('.rq-choices').forEach((group) => {
    group.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        group.querySelectorAll('.rq-choice').forEach((c) => c.classList.remove('rq-choice--checked'));
        radio.closest('.rq-choice')?.classList.add('rq-choice--checked');
        // Re-evaluate if project type changed (to update steps)
        if (radio.name === 'projectType') collectCurrentAnswers();
      });
    });
  });

  // Wire checkbox highlight
  $('rqStepCard').querySelectorAll('.rq-checks').forEach((group) => {
    group.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        cb.closest('.rq-check')?.classList.toggle('rq-check--checked', cb.checked);
      });
    });
  });
}

/* ---------- Collect answers ---------- */
function collectCurrentAnswers() {
  const step = getActiveSteps()[currentStep];
  if (!step) return;
  step.questions.forEach((qid) => {
    const q = Q[qid];
    if (q.type === 'checkboxes') {
      const inputs = $('rqStepCard').querySelectorAll(`input[name="${qid}"]:checked`);
      answers[qid] = Array.from(inputs).map((i) => i.value);
    } else if (q.type === 'radio') {
      const input = $('rqStepCard').querySelector(`input[name="${qid}"]:checked`);
      answers[qid] = input ? input.value : (answers[qid] || '');
    } else {
      const el = $(`rq_${qid}`);
      if (el) answers[qid] = el.value.trim();
    }
  });
}

function validateCurrentStep() {
  const step = getActiveSteps()[currentStep];
  for (const qid of step.questions) {
    if (!Q[qid].required) continue;
    const val = answers[qid];
    if (!val || (Array.isArray(val) && !val.length)) {
      const label = Q[qid].label;
      showStepError(`"${label}" is required.`);
      return false;
    }
  }
  return true;
}

function showStepError(msg) {
  let el = $('rqStepError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rqStepError';
    el.className = 'status status--error';
    $('rqStepCard').prepend(el);
  }
  el.textContent = msg;
  el.hidden = false;
}

function clearStepError() {
  const el = $('rqStepError');
  if (el) el.hidden = true;
}

/* ---------- Navigation ---------- */
function goNext() {
  collectCurrentAnswers();
  if (!validateCurrentStep()) return;
  clearStepError();
  const active = getActiveSteps();
  if (currentStep < active.length - 1) {
    currentStep++;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    showReview();
  }
}

function goBack() {
  clearStepError();
  if (currentStep > 0) {
    currentStep--;
    renderStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ---------- Review screen ---------- */
function showReview() {
  collectCurrentAnswers();
  $('rqWizard').hidden = true;
  $('rqReview').hidden = false;

  const shareUrl = buildShareUrl();
  $('rqShareUrl').value = shareUrl;

  renderAnswersSummary();

  if (isShareMode) {
    $('rqSharePanel').hidden = true;
    $('rqStaffPanel').hidden = false;
    $('rqReviewTitle').textContent = 'Client requirements summary';
    $('rqReviewSub').textContent = 'Review the client\'s answers below. You can edit any field, then generate the SRD.';
  }
}

function renderAnswersSummary() {
  const STEP_LABELS = {
    contact:  'About the Client',
    project:  'Project Overview',
    website:  'Website Details',
    webapp:   'Web App Details',
    mobile:   'Mobile App Details',
    software: 'Software Details',
    users:    'Users & Audience',
    timeline: 'Timeline & Budget',
    extra:    'Additional Info',
  };
  const activeSteps = getActiveSteps();
  const html = activeSteps.map((step) => {
    const rows = step.questions.map((qid) => {
      const q = Q[qid];
      const val = answers[qid];
      if (!val || (Array.isArray(val) && !val.length)) return '';
      const display = Array.isArray(val) ? val.join(', ') : val;
      const labelMap = {};
      if (q.type === 'radio' && Array.isArray(q.options)) {
        q.options.forEach((o) => { if (o.value) labelMap[o.value] = o.label; });
      }
      const displayVal = labelMap[display] || display;
      return `<div class="rq-summary__row">
        <div class="rq-summary__label">${esc(q.label)}</div>
        <div class="rq-summary__value">${esc(displayVal)}</div>
      </div>`;
    }).filter(Boolean).join('');
    if (!rows) return '';
    return `<div class="card rq-summary__section">
      <h3 class="rq-summary__heading">${esc(STEP_LABELS[step.id] || step.title)}</h3>
      ${rows}
    </div>`;
  }).join('');
  $('rqAnswersSummary').innerHTML = html;
}

function showWizard() {
  $('rqReview').hidden = true;
  $('rqWizard').hidden = false;
  renderStep();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Share URL ---------- */
function buildShareUrl() {
  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(answers))));
    return `${window.location.origin}${window.location.pathname}#share=${encoded}`;
  } catch {
    return window.location.href;
  }
}

function restoreFromShare(hash) {
  try {
    const match = hash.match(/[#&]share=([^&]*)/);
    if (!match) return false;
    const decoded = JSON.parse(decodeURIComponent(escape(atob(match[1]))));
    if (decoded && typeof decoded === 'object') {
      answers = decoded;
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/* ---------- Auth ---------- */
let authMode = 'login';

function showAuthModal() {
  $('authModal').classList.add('modal--visible');
  $('authEmail').focus();
}
function hideAuthModal() {
  $('authModal').classList.remove('modal--visible');
}
function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  $('authTitle').textContent = isLogin ? 'Sign in to PocketDevs' : 'Create an account';
  $('authSubmit').textContent = isLogin ? 'Sign in' : 'Create account';
  $('authNameRow').hidden = isLogin;
  $('authTabLogin').classList.toggle('auth-tab--active', isLogin);
  $('authTabSignup').classList.toggle('auth-tab--active', !isLogin);
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const name = $('authName').value.trim();
  const errEl = $('authError');
  errEl.hidden = true;
  $('authSubmit').disabled = true;
  try {
    const { error } = authMode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password, name);
    if (error) {
      errEl.textContent = error.message || String(error);
      errEl.className = 'status status--error';
      errEl.hidden = false;
    } else {
      hideAuthModal();
      updateAuthState();
    }
  } finally {
    $('authSubmit').disabled = false;
  }
}

async function updateAuthState() {
  const session = await getSession();
  const isLoggedIn = !!session;
  $('rqAuthBtn').hidden = isLoggedIn;
  $('rqUserMenu').hidden = !isLoggedIn;
  $('rqAuthGreeting').hidden = !isLoggedIn;
  if (isLoggedIn) {
    const name = session.user.user_metadata?.full_name || session.user.email || '';
    $('rqAuthGreeting').textContent = `Hi, ${name.split(' ')[0] || name}`;
    const initials = name.split(' ').map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
    $('rqUserMenuBtn').textContent = initials || 'U';
  }
}

/* ---------- Status helper ---------- */
function setStatus(kind, html) {
  const el = $('rqStatus');
  el.className = `status${kind ? ' status--' + kind : ''}`;
  el.innerHTML = html;
  el.hidden = false;
}

/* ---------- Generate SRD ---------- */
async function generateSRD() {
  const session = await getSession();
  if (!session || !session.access_token) {
    showAuthModal();
    setStatus('error', 'Please sign in to generate the SRD.');
    return;
  }

  const btn = $('rqGenerateBtn');
  btn.disabled = true;
  setStatus('working', '<span class="spinner"></span> Reading your answers and drafting the System Requirements Document… this can take 30–60 seconds.');

  try {
    const res = await fetch(REQ_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ answers }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) showAuthModal();
      setStatus('error', `Generation failed: ${esc(data?.error?.message || `HTTP ${res.status}`)}`);
      return;
    }
    const srd = data.srd;
    if (!srd) { setStatus('error', 'No SRD returned. Please try again.'); return; }
    renderSRD(srd);
    $('rqStatus').hidden = true;
    // Best-effort save to DB
    const docNo = `SRD-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
    const submissionData = {
      ...(currentSubmissionId ? { id: currentSubmissionId } : {}),
      client_name: answers.contactCompany || answers.contactName || '',
      project_name: answers.projectName || srd.projectName || '',
      project_type: answers.projectType || '',
      answers,
      srd_content: srd,
      doc_number: docNo,
      status: 'srd_generated',
    };
    try {
      const { data: saved, error } = await saveQuestionnaire(submissionData);
      if (!error && saved && saved[0]) currentSubmissionId = saved[0].id;
    } catch { /* non-blocking */ }
  } catch (err) {
    setStatus('error', `Network error: ${esc(err.message)}`);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Render SRD ---------- */
function renderSRD(srd) {
  const clientName = answers.contactName || '';
  const clientCompany = answers.contactCompany || '';
  const now = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const docNo = `SRD-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`;
  const projectType = { website: 'Website', webapp: 'Web Application', mobile: 'Mobile Application', software: 'Custom Software' }[answers.projectType] || answers.projectType || '';

  const cover = `
    <header class="p-cover">
      <div class="p-cover__top">
        <img src="assets/logo.svg" alt="Logo" class="p-cover__logo js-logo" />
        <div class="p-eyebrow">
          <div class="js-doc-no"><b>${esc(docNo)}</b></div>
          <div>Prepared ${esc(now)}</div>
          <div>${esc(projectType)}</div>
        </div>
      </div>
      <span class="p-kicker">System Requirements Document</span>
      <h1 class="p-title">${esc(srd.projectName || answers.projectName || 'Project SRD')}</h1>
      <div class="p-parties">
        <div class="p-party">
          <div class="p-party__label">Prepared for</div>
          <div class="p-party__name">${esc(clientCompany || clientName || '[Client]')}</div>
          ${clientName && clientCompany ? `<div class="p-party__meta">${esc(clientName)}</div>` : ''}
        </div>
        <div class="p-party">
          <div class="p-party__label">Prepared by</div>
          <div class="p-party__name">PocketDevs</div>
          <div class="p-party__meta">www.pocketdevs.ph</div>
        </div>
      </div>
    </header>`;

  const sec = [];
  let n = 1;

  sec.push(`<section class="p-section">${sectionHead(n++, 'Project Overview')}<div class="p-lede"><p>${esc(srd.projectOverview || '')}</p></div></section>`);

  sec.push(`<section class="p-section">${sectionHead(n++, 'Business Objectives')}${list(srd.businessObjectives)}</section>`);

  const roles = srd.userRoles && srd.userRoles.length
    ? `<div class="p-section__sub-head">User Roles</div>${list(srd.userRoles)}` : '';
  sec.push(`<section class="p-section">${sectionHead(n++, 'Target Users & Stakeholders')}<div class="p-lede"><p>${esc(srd.targetUsers || '')}</p></div>${roles}</section>`);

  const frHtml = (srd.functionalRequirements || []).map((mod) => `
    <div class="p-scope__group">
      <div class="p-scope__phase">${esc(mod.module)}</div>
      ${mod.description ? `<p class="p-lede__sm">${esc(mod.description)}</p>` : ''}
      <ul class="p-list">${(mod.requirements || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>`).join('');
  sec.push(`<section class="p-section">${sectionHead(n++, 'Functional Requirements')}<div class="p-scope">${frHtml}</div></section>`);

  const nfrRows = (srd.nonFunctionalRequirements || []).map((cat) =>
    `<tr><td><strong>${esc(cat.category)}</strong></td><td><ul class="p-list p-list--inline">${(cat.requirements || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></td></tr>`
  ).join('');
  sec.push(`<section class="p-section">${sectionHead(n++, 'Non-Functional Requirements')}
    <table class="p-table"><thead><tr><th>Category</th><th>Requirements</th></tr></thead><tbody>${nfrRows}</tbody></table></section>`);

  const tr = srd.technicalRecommendations || {};
  const integ = (tr.integrations || []).length ? `<div class="p-section__sub-head">Integrations</div>${list(tr.integrations)}` : '';
  sec.push(`<section class="p-section">${sectionHead(n++, 'Technical Recommendations')}
    ${tr.stack ? `<div class="p-section__sub-head">Recommended Stack</div><div class="p-lede"><p>${esc(tr.stack)}</p></div>` : ''}
    ${tr.hosting ? `<div class="p-section__sub-head">Hosting & Infrastructure</div><div class="p-lede"><p>${esc(tr.hosting)}</p></div>` : ''}
    ${integ}
    ${tr.rationale ? `<div class="p-section__sub-head">Rationale</div><div class="p-lede"><p>${esc(tr.rationale)}</p></div>` : ''}
  </section>`);

  const inHtml = list(srd.inScope);
  const outHtml = list(srd.outOfScope);
  sec.push(`<section class="p-section">${sectionHead(n++, 'Project Scope')}
    <div class="p-scope-split">
      <div><div class="p-scope-split__head p-scope-split__head--in">In Scope</div>${inHtml}</div>
      <div><div class="p-scope-split__head p-scope-split__head--out">Out of Scope</div>${outHtml}</div>
    </div></section>`);

  sec.push(`<section class="p-section">${sectionHead(n++, 'Timeline Estimate')}
    <div class="p-lede"><p>${esc(srd.timelineEstimate || '[TBD]')}</p></div></section>`);

  sec.push(`<section class="p-section">${sectionHead(n++, 'Budget Considerations')}
    <div class="p-lede"><p>${esc(srd.budgetNotes || '[TBD]')}</p></div></section>`);

  const assumptHtml = list(srd.assumptions);
  const openQHtml = list(srd.openQuestions);
  sec.push(`<section class="p-section">${sectionHead(n++, 'Assumptions & Open Questions')}
    ${assumptHtml ? `<div class="p-section__sub-head">Assumptions</div>${assumptHtml}` : ''}
    ${openQHtml ? `<div class="p-section__sub-head">Open Questions</div>${openQHtml}` : ''}
  </section>`);

  const footer = `<div class="p-docfooter"><span><b>PocketDevs</b></span><span>Confidential</span><span>www.pocketdevs.ph</span></div>`;

  const art = $('rqSRD');
  art.innerHTML = cover + sec.join('') + footer;
  art.setAttribute('contenteditable', 'true');
  art.setAttribute('spellcheck', 'false');

  $('rqSRDSection').hidden = false;
  $('rqEditorToolbar').hidden = false;
  $('rqDownloadBtn').hidden = false;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- PDF Download ---------- */
function downloadPDF() {
  const element = $('rqSRD');
  const docNo = document.querySelector('#rqSRD .js-doc-no')?.innerText?.trim() || 'SRD';
  const opt = {
    margin: [15, 15],
    filename: `${docNo}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };
  html2pdf().set(opt).from(element).save();
}

/* ---------- Rich text toolbar ---------- */
(function initToolbar() {
  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = $('rqEditorToolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        document.execCommand(btn.dataset.cmd, false, null);
      });
    });
  });
})();

/* ---------- Init ---------- */
async function init() {
  // Check for ?submission=ID (from dashboard link)
  const urlParams = new URLSearchParams(window.location.search);
  const submissionId = urlParams.get('submission');
  if (submissionId) {
    await updateAuthState();
    const submission = await fetchSubmissionById(submissionId);
    if (submission) {
      currentSubmissionId = submission.id;
      answers = submission.answers || {};
      isShareMode = true;
      showReview();
      if (submission.srd_content) {
        renderSRD(submission.srd_content);
      }
      // Clean up URL param without page reload
      const url = new URL(window.location.href);
      url.searchParams.delete('submission');
      window.history.replaceState({}, '', url.toString());
    } else {
      renderStep();
    }
    // Skip the rest of init's auth call since we already did it
    setupWiring();
    return;
  }

  const hash = window.location.hash;
  if (hash && hash.includes('share=')) {
    if (restoreFromShare(hash)) {
      isShareMode = true;
      showReview();
    } else {
      renderStep();
    }
  } else {
    renderStep();
  }

  setupWiring();
}

function setupWiring() {
  $('rqNextBtn').addEventListener('click', goNext);
  $('rqBackBtn').addEventListener('click', goBack);
  $('rqEditBtn').addEventListener('click', showWizard);

  $('rqCopyBtn').addEventListener('click', () => {
    const url = $('rqShareUrl').value;
    navigator.clipboard?.writeText(url).then(() => {
      $('rqCopyBtn').textContent = 'Copied!';
      setTimeout(() => { $('rqCopyBtn').textContent = 'Copy link'; }, 2000);
    });
  });

  $('rqGenerateBtn').addEventListener('click', generateSRD);
  $('rqDownloadBtn').addEventListener('click', downloadPDF);

  $('rqAuthBtn').addEventListener('click', showAuthModal);
  $('closeAuth').addEventListener('click', hideAuthModal);
  $('authModal').addEventListener('click', (e) => { if (e.target === $('authModal')) hideAuthModal(); });
  $('authTabLogin').addEventListener('click', () => setAuthMode('login'));
  $('authTabSignup').addEventListener('click', () => setAuthMode('signup'));
  $('authForm').addEventListener('submit', handleAuth);

  $('rqUserMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('rqUserMenuDropdown');
    dd.hidden = !dd.hidden;
  });
  $('rqUserMenuLogout')?.addEventListener('click', async () => {
    $('rqUserMenuDropdown').hidden = true;
    await signOut();
    updateAuthState();
  });
  document.addEventListener('click', (e) => {
    const menu = $('rqUserMenu');
    if (!menu?.hidden && !menu?.contains(e.target)) {
      const dd = $('rqUserMenuDropdown');
      if (dd) dd.hidden = true;
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if ($('rqWizard').hidden) return;
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      goNext();
    }
  });

  updateAuthState();
  onAuthChange(() => updateAuthState());
}

init();
