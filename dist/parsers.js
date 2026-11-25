import { log } from './logger.js';
let cachedHighEntropy = null;
export const initUserAgentData = () => {
    cachedHighEntropy = null;
    const uad = navigator.userAgentData;
    if (!uad?.getHighEntropyValues) {
        return;
    }
    uad
        .getHighEntropyValues(['platformVersion', 'model'])
        .then(values => {
        cachedHighEntropy = {};
        if (values.platformVersion) {
            cachedHighEntropy.osVersion = values.platformVersion;
        }
        if (values.model) {
            cachedHighEntropy.device = values.model;
        }
    })
        .catch((err) => {
        log.warn('High-entropy UA data unavailable:', err);
    });
};
const ENGINE_BRAND = 'chromium';
// Chromium keys the GREASE separators to its major version, so the punctuation differs between
// builds (";Not A Brand", "Not/A)Brand", ...). Match on the letters, which don't move.
const isGrease = (brand) => brand.replace(/[^a-z]/gi, '').toLowerCase() === 'notabrand';
// Position is unspecified and varies by build, so choose by name. Longest wins, or an Edge
// WebView2 embed (which reports "Microsoft Edge" too) is flattened into the browser.
const bySpecificity = (a, b) => b.brand.length - a.brand.length || (a.brand < b.brand ? -1 : a.brand > b.brand ? 1 : 0);
const selectBrand = (brands) => {
    const realBrands = (brands ?? []).filter(b => b.brand && !isGrease(b.brand));
    const specificBrands = realBrands.filter(b => b.brand.toLowerCase() !== ENGINE_BRAND);
    const candidates = specificBrands.length > 0 ? specificBrands : realBrands;
    return candidates.sort(bySpecificity)[0];
};
export const parseUserAgentData = () => {
    try {
        const uad = navigator.userAgentData;
        if (!uad) {
            return {};
        }
        const result = {};
        const brand = selectBrand(uad.brands);
        if (brand) {
            result.$browser = brand.brand;
            result.$browserVersion = brand.version;
        }
        if (uad.platform) {
            result.$os = uad.platform;
        }
        if (cachedHighEntropy?.osVersion) {
            result.$osVersion = cachedHighEntropy.osVersion;
        }
        if (cachedHighEntropy?.device) {
            result.$device = cachedHighEntropy.device;
        }
        result.$mobile = String(uad.mobile);
        return result;
    }
    catch (err) {
        log.warn('Failed to parse user agent data:', err);
        return {};
    }
};
export const parseUtmParams = (search) => {
    try {
        const params = new URLSearchParams(search);
        const result = {};
        const source = params.get('utm_source');
        if (source) {
            result.$utmSource = source;
        }
        const medium = params.get('utm_medium');
        if (medium) {
            result.$utmMedium = medium;
        }
        const campaign = params.get('utm_campaign');
        if (campaign) {
            result.$utmCampaign = campaign;
        }
        const content = params.get('utm_content');
        if (content) {
            result.$utmContent = content;
        }
        const term = params.get('utm_term');
        if (term) {
            result.$utmTerm = term;
        }
        return result;
    }
    catch (err) {
        log.warn('Failed to parse UTM params:', err);
        return {};
    }
};
