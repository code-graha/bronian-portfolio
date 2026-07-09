// Tailwind config
tailwind.config = {
    theme: {
        extend: {
            colors: {
                'brand-black': '#0a0a0a',
                'brand-dark': '#111111',
                'brand-orange': '#FF4500',
                'brand-orange-hover': '#FF6600',
                'brand-gray': '#222222',
                'brand-light-gray': '#a3a3a3',
                'brand-white': '#f0f0f0'
            },
            fontFamily: {
                'display': ['Clash Display', 'Inter', 'sans-serif'],
                'body': ['Space Grotesk', 'Inter', 'monospace'],
            },
            animation: {
                'spin-slow': 'spin 12s linear infinite',
                'marquee': 'marquee 30s linear infinite',
            },
            keyframes: {
                marquee: {
                    '0%': { transform: 'translateX(0%)' },
                    '100%': { transform: 'translateX(-50%)' },
                }
            }
        }
    }
}

// ========================================
// DEFAULT DATA (fallback if JSON fails)
// ========================================
const defaultPortfolioData = {
    siteTitle: "",
    personal: {
        name: "",
        brandName: "",
        title: "",
        subtitle: "",
        location: "",
        email: "",
        phone: "",
        availableForWork: false,
        availabilityText: "",
        heroHeadline: [],
        heroDescription: "",
        socialLinks: []
    },
    marqueeItems: [],
    stats: [],
    projects: [],
    about: { tagline: "", headline: [], description: "", image: "", highlights: [] },
    services: [],
    process: [],
    testimonials: [],
    contact: { headline: [], description: "", serviceOptions: [] },
    footer: { tagline: "", bottomText: "" }
};

let portfolioData = { ...defaultPortfolioData };

// ========================================
// SECTION LOADER HELPER
// ========================================
function hideLoader(loaderId) {
    var loader = document.getElementById(loaderId);
    if (loader) loader.style.display = 'none';
}

// ========================================
// HEX TO DATA URL HELPER
// ========================================
function hexToDataURL(hex) {
    if (!hex || hex.startsWith('http') || hex.startsWith('data:')) return hex;
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    var binary = '';
    for (var j = 0; j < bytes.length; j++) {
        binary += String.fromCharCode(bytes[j]);
    }
    return 'data:image/jpeg;base64,' + btoa(binary);
}

// ========================================
// ICON HELPER
// portfolio-data.json stores icons as "fa-solid fa-icon-name" strings (kept
// for backwards compatibility); this pulls out the icon-name token and
// renders it against the local sprite (assets/icons/sprite.svg) instead of
// Font Awesome. Only icons already built into that sprite will render.
// ========================================
function iconHTML(iconClass, extraClass) {
    var name = '';
    (iconClass || '').trim().split(/\s+/).forEach(function (part) {
        if (part.indexOf('fa-') === 0 && part !== 'fa-solid' && part !== 'fa-brands' && part !== 'fa-regular') {
            name = part.slice(3);
        }
    });
    var cls = 'icon' + (extraClass ? ' ' + extraClass : '');
    return '<svg class="' + cls + '" aria-hidden="true"><use href="/assets/icons/sprite.svg#' + name + '"></use></svg>';
}

// ========================================
// CATEGORY LABEL MAP
// ========================================
const categoryLabels = {
    branding: "Branding",
    web: "Web Design",
    print: "Print",
    illustration: "Illustration"
};

// ========================================
// LOADING SCREEN
// ========================================
function dismissLoadingScreen() {
    var screen = document.getElementById('loadingScreen');
    if (!screen || screen.classList.contains('fade-out')) return;
    screen.classList.add('fade-out');
    setTimeout(function () { screen.remove(); }, 500);
}

// ========================================
// LOAD DATA FROM JSON + GOOGLE SHEETS
// ========================================
async function loadPortfolioData() {
    let data;
    try {
        // Reuse the fetch started in <head> (see index.html) instead of
        // requesting portfolio-data.json a second time.
        data = window.__earlyPortfolioData
            ? await window.__earlyPortfolioData
            : await fetch('portfolio-data.json').then(function (r) { return r.ok ? r.json() : null; });

        if (!data) {
            console.log('JSON not found, using defaults');
            updatePageContent(defaultPortfolioData);
            dismissLoadingScreen();
            return;
        }
        Object.assign(portfolioData, data);
    } catch (error) {
        console.log('Error loading JSON, using defaults:', error);
        updatePageContent(defaultPortfolioData);
        dismissLoadingScreen();
        return;
    }

    // Render static sections immediately (hero, about, services, etc.)
    updatePageContent(data);

    // Use early-fetched promises (started in <head>) or fall back to fresh fetch
    const sheetURL = data.sheetURL;
    if (sheetURL && sheetURL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        var cacheBust = '&_t=' + Date.now();
        const projectsFetch = window.__earlyProjects || fetch(sheetURL + '?type=projects' + cacheBust)
            .then(function (res) { return res.ok ? res.json() : null; })
            .catch(function () { return null; });

        const reviewsFetch = window.__earlyReviews || fetch(sheetURL + '?type=reviews' + cacheBust)
            .then(function (res) { return res.ok ? res.json() : null; })
            .catch(function () { return null; });

        const [projData, reviewsData] = await Promise.all([projectsFetch, reviewsFetch]);

        // Dismiss loading screen
        dismissLoadingScreen();

        // Update projects
        if (projData && projData.status === 'success' && Array.isArray(projData.projects) && projData.projects.length > 0) {
            data.projects = projData.projects;
            portfolioData.projects = projData.projects;
            var workSection = document.getElementById('work');
            if (workSection) workSection.style.display = '';
            var filtersSection = document.getElementById('filters');
            if (filtersSection) filtersSection.style.display = '';
            renderFilters(data);
            renderProjects(data);
        } else {
            hideLoader('workLoader');
        }

        // Update reviews (only show featured reviews on portfolio)
        if (reviewsData && reviewsData.status === 'success' && Array.isArray(reviewsData.reviews)) {
            var featuredReviews = reviewsData.reviews.filter(function (r) { return r.featured; });
            if (featuredReviews.length > 0) {
                data.testimonials = featuredReviews;
                portfolioData.testimonials = featuredReviews;
                var testimonialsSection = document.getElementById('testimonials');
                if (testimonialsSection) testimonialsSection.style.display = '';
                renderTestimonials(data);
            } else {
                hideLoader('testimonialsLoader');
            }
        } else {
            hideLoader('testimonialsLoader');
        }
    } else {
        dismissLoadingScreen();
    }
}

// ========================================
// UPDATE ALL PAGE CONTENT FROM DATA
// ========================================
function updatePageContent(data) {
    if (data.siteTitle) {
        document.title = data.siteTitle;
    }

    renderNavbar(data);
    renderHero(data);
    renderMarquee(data);
    renderFilters(data);
    renderProjects(data);
    renderAbout(data);
    renderStats(data);
    renderServices(data);
    renderProcess(data);
    renderTestimonials(data);
    renderContact(data);
    renderFooter(data);
}

// ========================================
// NAVBAR
// ========================================
function renderNavbar(data) {
    if (!data.personal) return;

    const brandName = data.personal.brandName || '';
    const logoAlphabet = data.personal.logoAlphabet || (brandName ? brandName.charAt(0) : '');

    const navLetter = document.querySelector('#navbar .nav-logo-letter');
    if (navLetter) navLetter.textContent = logoAlphabet;

    const navBrand = document.querySelector('#navbar .nav-brand-name');
    if (navBrand) navBrand.innerHTML = `${brandName.replace(/\.$/, '')}<span class="text-brand-orange">.</span>`;
}

// ========================================
// HERO SECTION
// ========================================
function renderHero(data) {
    if (!data.personal) return;

    const badge = document.querySelector('#hero .hero-badge-text');
    if (badge) badge.textContent = data.personal.availabilityText || 'Available for Freelance Work';

    const headline = document.querySelector('#hero .hero-headline');
    if (headline && data.personal.heroHeadline) {
        const h = data.personal.heroHeadline;
        headline.innerHTML = `${h[0]} <span class="text-outline">${h[1]}</span><br><span class="text-brand-orange">${h[2]}</span> ${h[3]}`;
    }

    const subtitle = document.querySelector('#hero .hero-subtitle');
    if (subtitle) subtitle.textContent = data.personal.heroDescription || '';

    // Show/hide availability badge
    const badgeContainer = document.querySelector('#hero .hero-badge');
    if (badgeContainer) {
        badgeContainer.style.display = data.personal.availableForWork === true ? 'inline-flex' : 'none';
    }
}

// ========================================
// MARQUEE
// ========================================
function renderMarquee(data) {
    const section = document.getElementById('marquee');
    const container = document.querySelector('#marquee .marquee-content');
    if (!data.marqueeItems || data.marqueeItems.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    if (!container) return;

    // Duplicate items for seamless loop
    const items = data.marqueeItems;
    const allItems = [...items, ...items];
    container.innerHTML = allItems.map(item =>
        `<span class="text-2xl font-display font-bold uppercase mx-8">/// ${item}</span>`
    ).join('');
}

// ========================================
// FILTER BAR
// ========================================
function renderFilters(data) {
    const section = document.getElementById('filters');
    const container = document.querySelector('#filters .filter-buttons');
    if (!data.projects || data.projects.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    if (!container) return;

    // Auto-generate categories from actual project data
    const usedCategories = [...new Set(data.projects.map(p => p.category))];
    const filters = [
        { label: 'All Work', filter: 'all' },
        ...usedCategories.map(cat => ({
            label: categoryLabels[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : cat),
            filter: cat
        }))
    ];

    const projectCount = data.projects.length;

    container.innerHTML = filters.map((cat, index) => {
        const isActive = index === 0;
        const activeClasses = isActive
            ? 'bg-brand-orange text-black clip-tag'
            : 'border border-brand-gray text-brand-light-gray';
        return `<button class="filter-btn min-h-[44px] px-6 py-2 font-bold uppercase text-sm hover:bg-white hover:text-black transition-colors ${activeClasses}" data-filter="${cat.filter}">${cat.label}</button>`;
    }).join('');

    const countEl = document.querySelector('#filters .project-count');
    if (countEl) countEl.textContent = `${projectCount} Projects`;

    initFilterLogic();
}

// ========================================
// PROJECTS GRID
// ========================================
function renderProjects(data) {
    hideLoader('workLoader');
    const section = document.getElementById('work');
    const grid = document.querySelector('#work .masonry-grid');
    if (!data.projects || data.projects.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    if (!grid) return;

    grid.innerHTML = data.projects.map(project => {
        const catLabel = categoryLabels[project.category] || (project.category ? project.category.charAt(0).toUpperCase() + project.category.slice(1) : project.category);
        return `
            <div class="break-inside-avoid mb-8 group project-card" data-category="${project.category}">
                <div class="brutalist-card bg-brand-dark relative overflow-hidden">
                    <div class="aspect-[${project.aspect}] w-full overflow-hidden relative">
                        <img src="${project.image}" alt="${project.title}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 grayscale group-hover:grayscale-0" loading="lazy" decoding="async">
                        <div class="absolute inset-0 bg-brand-orange/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        <div class="absolute top-0 right-0 bg-brand-orange text-black font-bold px-4 py-2 text-xs uppercase z-10 clip-tag tracking-wider">${catLabel}</div>
                    </div>
                    <div class="p-6 border-t border-brand-gray bg-brand-dark relative z-20">
                        <div class="flex justify-between items-start mb-2">
                            <h3 class="text-2xl font-bold text-white group-hover:text-brand-orange transition-colors">${project.title}</h3>
                            <span class="text-xs text-brand-light-gray border border-brand-light-gray px-2 py-1 uppercase">${project.year}</span>
                        </div>
                        <p class="text-brand-light-gray text-sm">${project.description}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================
// ABOUT SECTION
// ========================================
function renderAbout(data) {
    const aboutSection = document.getElementById('about');
    if (!data.about || (!data.about.description && (!data.about.highlights || data.about.highlights.length === 0))) {
        if (aboutSection) aboutSection.style.display = 'none';
        return;
    }

    const tagline = document.querySelector('#about .about-tagline');
    if (tagline) tagline.textContent = data.about.tagline || '/// About Me';

    const headline = document.querySelector('#about .about-headline');
    if (headline && data.about.headline) {
        const h = data.about.headline;
        headline.innerHTML = `${h[0]} <br><span class="text-brand-orange">${h[1]}</span> ${h[2]}`;
    }

    const desc = document.querySelector('#about .about-description');
    if (desc) desc.textContent = data.about.description || '';

    const img = document.querySelector('#about .about-image');
    if (img && data.about.image) img.src = data.about.image;

    const highlights = document.querySelector('#about .about-highlights');
    if (highlights && data.about.highlights) {
        highlights.innerHTML = data.about.highlights.map(h => `
            <div class="flex items-start gap-4">
                <div class="w-12 h-12 border border-brand-gray flex items-center justify-center text-brand-orange shrink-0">
                    ${iconHTML(h.icon, 'text-xl')}
                </div>
                <div>
                    <h4 class="text-xl font-bold uppercase mb-1">${h.title}</h4>
                    <p class="text-sm text-brand-light-gray">${h.text}</p>
                </div>
            </div>
        `).join('');
    }
}

// ========================================
// STATS SECTION
// ========================================
function renderStats(data) {
    const statsSection = document.getElementById('stats');
    const container = document.querySelector('#stats .stats-grid');
    if (!data.stats || data.stats.length === 0) {
        if (statsSection) statsSection.style.display = 'none';
        return;
    }
    if (!container) return;

    container.innerHTML = data.stats.map((stat, index) => {
        const borderClass = index > 0 ? 'border-l border-brand-gray' : '';
        return `
            <div class="p-4 ${borderClass}">
                <h3 class="text-5xl font-bold font-display text-${stat.color} mb-2">${stat.value}</h3>
                <p class="text-sm uppercase tracking-widest text-brand-light-gray">${stat.label}</p>
            </div>
        `;
    }).join('');
}

// ========================================
// SERVICES SECTION
// ========================================
function renderServices(data) {
    const servicesSection = document.getElementById('services');
    const grid = document.querySelector('#services .services-grid');
    if (!data.services || data.services.length === 0) {
        if (servicesSection) servicesSection.style.display = 'none';
        return;
    }
    if (!grid) return;

    grid.innerHTML = data.services.map((service, index) => {
        const isRight = index % 2 !== 0;
        const isBottom = index >= data.services.length - 2;
        let borderClasses = 'border-b';
        if (isRight) borderClasses = 'border-b';
        else borderClasses = 'border-b md:border-r';

        // Last row bottom border handling
        if (isBottom && !isRight) borderClasses = 'border-b md:border-b-0 md:border-r';
        if (isBottom && isRight) borderClasses = '';

        return `
            <div class="p-8 md:p-12 ${borderClasses} border-brand-gray hover:bg-brand-dark transition-colors group">
                <div class="flex items-center gap-4 mb-6">
                    <div class="service-icon w-14 h-14 border border-brand-gray flex items-center justify-center text-brand-orange transition-colors">
                        ${iconHTML(service.icon, 'text-2xl')}
                    </div>
                    <h3 class="text-2xl font-bold uppercase">${service.title}</h3>
                </div>
                <p class="text-brand-light-gray text-sm mb-6 leading-relaxed">${service.description}</p>
                <div class="flex items-center justify-between">
                    <span class="text-brand-orange font-bold text-lg">From ${service.price}</span>
                    <a href="#contact" class="text-xs uppercase tracking-widest text-brand-light-gray hover:text-brand-orange transition-colors">Get a Quote <svg class="icon ml-1"><use href="/assets/icons/sprite.svg#arrow-right"></use></svg></a>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================
// PROCESS SECTION
// ========================================
function renderProcess(data) {
    const processSection = document.getElementById('process');
    const grid = document.querySelector('#process .process-grid');
    if (!data.process || data.process.length === 0) {
        if (processSection) processSection.style.display = 'none';
        return;
    }
    if (!grid) return;

    grid.innerHTML = data.process.map(step => `
        <div class="relative group">
            <div class="process-number text-7xl font-display font-bold text-brand-gray transition-colors mb-4">${step.step}</div>
            <h3 class="text-xl font-bold uppercase mb-3">${step.title}</h3>
            <p class="text-brand-light-gray text-sm leading-relaxed">${step.text}</p>
        </div>
    `).join('');
}

// ========================================
// TESTIMONIALS SECTION
// ========================================
function renderTestimonials(data) {
    hideLoader('testimonialsLoader');
    const testimonialsSection = document.getElementById('testimonials');
    const grid = document.querySelector('#testimonials .testimonials-grid');
    if (!data.testimonials || data.testimonials.length === 0) {
        if (testimonialsSection) testimonialsSection.style.display = 'none';
        return;
    }
    if (!grid) return;

    grid.innerHTML = data.testimonials.map((t, index) => {
        const isFeatured = t.featured;
        const borderClass = isFeatured ? 'border-brand-orange' : 'border-white group-hover:border-brand-orange transition-colors';
        const offsetClass = index === 1 ? 'mt-12 md:mt-0' : index === 2 ? 'mt-24 md:mt-0' : index === 3 ? 'mt-12 md:mt-0' : '';

        return `
            <div class="relative group ${offsetClass}">
                <div class="relative overflow-hidden mb-6 border-b-4 ${borderClass}">
                    <img src="${hexToDataURL(t.image)}" alt="${t.name}" class="w-full aspect-[4/5] object-cover grayscale contrast-125" loading="lazy" decoding="async">
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90"></div>
                    <div class="absolute bottom-0 left-0 p-6 w-full">
                        <svg class="icon text-brand-orange text-3xl mb-4"><use href="/assets/icons/sprite.svg#quote-left"></use></svg>
                        <p class="text-lg font-bold text-white mb-4 leading-tight">"${t.quote}"</p>
                        <div>
                            <h4 class="font-bold uppercase text-brand-orange">${t.name}</h4>
                            <span class="text-xs text-brand-light-gray uppercase">${t.role}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// ========================================
// CONTACT SECTION
// ========================================
function renderContact(data) {
    const contactSection = document.getElementById('contact');
    if (!data.contact || (!data.contact.headline && !data.contact.description)) {
        if (contactSection) contactSection.style.display = 'none';
        return;
    }

    const headline = document.querySelector('#contact .contact-headline');
    if (headline && data.contact.headline) {
        const h = data.contact.headline;
        headline.innerHTML = `${h[0]} <br>${h[1]} <span class="text-white">${h[2]}</span>`;
    }

    const desc = document.querySelector('#contact .contact-description');
    if (desc) desc.textContent = data.contact.description || '';

    // Contact info
    if (data.personal) {
        const emailEl = document.querySelector('#contact .contact-email');
        if (emailEl) {
            emailEl.textContent = data.personal.email;
            emailEl.href = `mailto:${data.personal.email}`;
        }

        const phoneEl = document.querySelector('#contact .contact-phone');
        if (phoneEl) {
            phoneEl.textContent = data.personal.phone;
            phoneEl.href = `tel:${data.personal.phone.replace(/\s/g, '')}`;
        }
    }

    // Service options
    const select = document.querySelector('#contact .contact-service-select');
    if (select && data.contact.serviceOptions) {
        select.innerHTML = data.contact.serviceOptions.map(opt =>
            `<option value="${opt.value}">${opt.label}</option>`
        ).join('');
    }
}

// ========================================
// FOOTER
// ========================================
function renderFooter(data) {
    if (!data.personal) return;

    const brand = data.personal.brandName || '';
    const logoAlphabet = data.personal.logoAlphabet || (brand ? brand.charAt(0) : '');

    const footerLetter = document.querySelector('#footer .footer-logo-letter');
    if (footerLetter) footerLetter.textContent = logoAlphabet;

    const brandName = document.querySelector('#footer .footer-brand-name');
    if (brandName) brandName.innerHTML = `${brand.replace(/\.$/, '')}<span class="text-brand-orange">.</span>`;

    const tagline = document.querySelector('#footer .footer-tagline');
    if (tagline && data.footer) tagline.textContent = data.footer.tagline || '';

    // Social links
    const socialContainer = document.querySelector('#footer .footer-social-links');
    if (socialContainer && data.personal.socialLinks) {
        socialContainer.innerHTML = data.personal.socialLinks.map(link =>
            `<a href="${link.url}" class="w-9 h-9 border border-brand-gray flex items-center justify-center text-brand-light-gray hover:bg-brand-orange hover:text-black hover:border-brand-orange transition-all duration-300" aria-label="${link.name}" target="_blank" rel="noopener">
                ${iconHTML(link.icon, 'text-sm')}
            </a>`
        ).join('');
    }

    // Copyright
    const copyright = document.querySelector('#footer .footer-copyright');
    if (copyright) copyright.textContent = `\u00A9 ${new Date().getFullYear()} ${data.personal.name}. All Rights Reserved.`;

    // Bottom text
    const bottomText = document.querySelector('#footer .footer-bottom-text');
    if (bottomText && data.footer) bottomText.innerHTML = data.footer.bottomText || '';
}

// ========================================
// PORTFOLIO FILTER LOGIC
// ========================================
function initFilterLogic() {
    const filterBtns = document.querySelectorAll('.filter-btn');

    filterBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            // Update active style
            filterBtns.forEach(function (b) {
                b.classList.remove('bg-brand-orange', 'text-black', 'clip-tag');
                b.classList.add('border', 'border-brand-gray', 'text-brand-light-gray');
            });
            btn.classList.add('bg-brand-orange', 'text-black', 'clip-tag');
            btn.classList.remove('border', 'border-brand-gray', 'text-brand-light-gray');

            var filter = btn.getAttribute('data-filter');
            var projectCards = document.querySelectorAll('.project-card');
            var visibleCount = 0;
            projectCards.forEach(function (card) {
                if (filter === 'all' || card.getAttribute('data-category') === filter) {
                    card.style.display = '';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });

            var countEl = document.querySelector('#filters .project-count');
            if (countEl) countEl.textContent = visibleCount + ' Projects';
        });
    });
}

// ========================================
// MOBILE MENU
// ========================================
function openMobileMenu() {
    var menu = document.getElementById('mobileMenu');
    var backdrop = document.getElementById('menuBackdrop');
    if (menu) menu.classList.add('open');
    if (backdrop) backdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
    var menu = document.getElementById('mobileMenu');
    var backdrop = document.getElementById('menuBackdrop');
    if (menu) menu.classList.remove('open');
    if (backdrop) backdrop.classList.add('hidden');
    document.body.style.overflow = '';
}

// ========================================
// CONTACT FORM
// ========================================
function initContactForm() {
    var form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        var submitBtn = form.querySelector('button[type="submit"]');
        var btnText = submitBtn.querySelector('.btn-text');
        var btnLoading = submitBtn.querySelector('.btn-loading');
        var successMsg = document.getElementById('formSuccess');
        var errorMsg = document.getElementById('formError');

        // Hide previous messages
        if (successMsg) successMsg.classList.add('hidden');
        if (errorMsg) errorMsg.classList.add('hidden');

        // Clear previous field errors
        form.querySelectorAll('.field-error').forEach(function (el) { el.classList.add('hidden'); });
        form.querySelectorAll('input, textarea, select').forEach(function (el) { el.classList.remove('ring-2', 'ring-red-500'); });

        // Get form data
        var name = form.querySelector('[name="name"]').value.trim();
        var email = form.querySelector('[name="email"]').value.trim();
        var service = form.querySelector('[name="service"]').value;
        var message = form.querySelector('[name="message"]').value.trim();

        // Validate fields with inline errors
        var hasError = false;
        var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!name) {
            var nameInput = form.querySelector('[name="name"]');
            nameInput.classList.add('ring-2', 'ring-red-500');
            nameInput.parentElement.querySelector('.field-error').classList.remove('hidden');
            hasError = true;
        }
        if (!email || !emailRegex.test(email)) {
            var emailInput = form.querySelector('[name="email"]');
            emailInput.classList.add('ring-2', 'ring-red-500');
            emailInput.parentElement.querySelector('.field-error').classList.remove('hidden');
            hasError = true;
        }
        if (!service) {
            var serviceInput = form.querySelector('[name="service"]');
            serviceInput.classList.add('ring-2', 'ring-red-500');
            serviceInput.parentElement.querySelector('.field-error').classList.remove('hidden');
            hasError = true;
        }
        if (!message) {
            var msgInput = form.querySelector('[name="message"]');
            msgInput.classList.add('ring-2', 'ring-red-500');
            msgInput.parentElement.querySelector('.field-error').classList.remove('hidden');
            hasError = true;
        }
        if (hasError) return;

        // Show loading
        submitBtn.disabled = true;
        if (btnText) btnText.classList.add('hidden');
        if (btnLoading) btnLoading.classList.remove('hidden');

        var googleScriptURL = portfolioData.sheetURL || '';

        if (!googleScriptURL || googleScriptURL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            // No backend configured - show success anyway
            if (successMsg) successMsg.classList.remove('hidden');
            form.reset();
            submitBtn.disabled = false;
            if (btnText) btnText.classList.remove('hidden');
            if (btnLoading) btnLoading.classList.add('hidden');

            setTimeout(function () {
                if (successMsg) successMsg.classList.add('hidden');
            }, 5000);
            return;
        }

        try {
            await fetch(googleScriptURL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'contacts',
                    name: name,
                    email: email,
                    service: service,
                    message: message,
                    timestamp: new Date().toISOString()
                })
            });

            if (successMsg) successMsg.classList.remove('hidden');
            form.reset();
        } catch (err) {
            console.error('Form error:', err);
            if (errorMsg) errorMsg.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            if (btnText) btnText.classList.remove('hidden');
            if (btnLoading) btnLoading.classList.add('hidden');
        }
    });
}

// ========================================
// NAVBAR SCROLL EFFECT
// ========================================
function initNavbarScroll() {
    window.addEventListener('scroll', function () {
        var navbar = document.getElementById('navbar');
        if (!navbar) return;
        if (window.scrollY > 50) {
            navbar.classList.add('shadow-lg');
        } else {
            navbar.classList.remove('shadow-lg');
        }
    });
}

// ========================================
// INIT ON DOM READY
// ========================================
document.addEventListener('DOMContentLoaded', function () {
    loadPortfolioData();
    initContactForm();
    initNavbarScroll();

    // Mobile menu button
    var menuBtn = document.getElementById('menuBtn');
    var menuClose = document.getElementById('menuClose');
    var menuBackdrop = document.getElementById('menuBackdrop');
    var mobileLinks = document.querySelectorAll('.mobile-link');

    if (menuBtn) menuBtn.addEventListener('click', openMobileMenu);
    if (menuClose) menuClose.addEventListener('click', closeMobileMenu);
    if (menuBackdrop) menuBackdrop.addEventListener('click', closeMobileMenu);
    mobileLinks.forEach(function (link) {
        link.addEventListener('click', closeMobileMenu);
    });

    // Close mobile menu on resize to desktop
    window.addEventListener('resize', function () {
        if (window.innerWidth >= 768) closeMobileMenu();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeMobileMenu();
    });
});

// Export for HTML onclick handlers
window.openMobileMenu = openMobileMenu;
window.closeMobileMenu = closeMobileMenu;
