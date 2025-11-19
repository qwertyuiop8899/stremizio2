// Scraper Unificato: UIndex + Il Corsaro Nero + Knaben con o senza Real-Debrid (Versione Vercel)

import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';

// ✅ Import CommonJS modules (db-helper, id-converter)
const require = createRequire(import.meta.url);
const dbHelper = require('../db-helper.cjs');
const { completeIds } = require('../lib/id-converter.cjs');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// ✅ Torrentio placeholder videos (hosted by Torrentio)
const TORRENTIO_VIDEO_BASE = 'https://torrentio.strem.fun';

// ✅ Safe Base64 encoding/decoding for Node.js
const atob = (str) => Buffer.from(str, 'base64').toString('utf-8');
const btoa = (str) => Buffer.from(str, 'utf-8').toString('base64');

// ✅ Improved HTML Entity Decoder
function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<', 
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' ',
        '&#8217;': "'",
        '&#8220;': '"',
        '&#8221;': '"',
        '&#8211;': '–',
        '&#8212;': '—'
    };
    
    return text.replace(/&[#\w]+;/g, match => entities[match] || match);
}

// ✅ Enhanced Query Cleaning (from uiai.js)
function cleanSearchQuery(query) {
    console.log(`🧹 Cleaning query: "${query}"`);
    
    // Remove IMDb ID pattern if present
    if (query.match(/^tt\d+$/)) {
        console.log(`⚠️ Raw IMDb ID detected: ${query}. This should be converted to movie title before calling scraper.`);
        return null;
    }
    
    // Clean up the query for better search results
    const cleaned = query
        .replace(/\s*\(\d{4}\)\s*$/, '') // Remove year at the end
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ') // Replace special chars, keeping unicode letters/numbers
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    
    console.log(`✨ Cleaned query: "${cleaned}"`);
    return cleaned;
}

// ✅ Enhanced Quality Extraction
function extractQuality(title) {
    if (!title) return '';
    
    // More comprehensive quality patterns
    const qualityPatterns = [
        /\b(2160p|4k|uhd)\b/i,
        /\b(1080p)\b/i,
        /\b(720p)\b/i,
        /\b(480p|sd)\b/i,
        /\b(webrip|web-rip)\b/i,
        /\b(bluray|blu-ray|bdremux|bd)\b/i,
        /\b(remux)\b/i,
        /\b(hdrip|hdr)\b/i,
        /\b(cam|ts|tc)\b/i
    ];
    
    for (const pattern of qualityPatterns) {
        const match = title.match(pattern);
        if (match) return match[1].toLowerCase();
    }
    
    return '';
}

// ✅ Improved Info Hash Extraction
function extractInfoHash(magnet) {
    if (!magnet) return null;
    const match = magnet.match(/btih:([A-Fa-f0-9]{40}|[A-Za-z2-7]{32})/i);
    if (!match) return null;
    
    // Convert base32 to hex if needed
    if (match[1].length === 32) {
        // This is base32, convert to hex (simplified)
        return match[1].toUpperCase();
    }
    
    return match[1].toUpperCase();
}

// ✅ Enhanced Size Parsing
function parseSize(sizeStr) {
    if (!sizeStr || sizeStr === '-' || sizeStr.toLowerCase() === 'unknown') return 0;
    
    const match = sizeStr.match(/([\d.,]+)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
    if (!match) return 0;
    
    const [, value, unit] = match;
    const cleanValue = parseFloat(value.replace(',', '.'));
    
    const multipliers = {
        'B': 1,
        'KB': 1024, 'KIB': 1024,
        'MB': 1024 ** 2, 'MIB': 1024 ** 2,
        'GB': 1024 ** 3, 'GIB': 1024 ** 3,  
        'TB': 1024 ** 4, 'TIB': 1024 ** 4
    };
    
    return Math.round(cleanValue * (multipliers[unit.toUpperCase()] || 1));
}

// ✅ Formattazione dimensione file
function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ✅ Italian Language Detection
function isItalian(title, italianMovieTitle = null) {
    if (!title) return false;
    // ✅ MODIFICA: Rimosso "multi" e "dual" da qui per evitare conflitti.
    // Ora questa funzione rileva solo l'italiano esplicito.
    const italianRegex = /\b(ita|italian|sub[.\s]?ita|nuita)\b/i;
    if (italianRegex.test(title)) {
        return true;
    }

    if (italianMovieTitle) {
        const normalizedTorrentTitle = title.toLowerCase();
        const normalizedItalianTitle = italianMovieTitle.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const italianWords = normalizedItalianTitle.split(' ')
            .filter(word => word.length > 2) // Filtra parole troppo corte
            .filter(word => !['del', 'al', 'dal', 'nel', 'sul', 'un', 'il', 'lo', 'la', 'gli', 'le', 'con', 'per', 'che', 'non'].includes(word)); // Filtra parole comuni
        
        if (italianWords.length > 0) {
            const matchingWords = italianWords.filter(word => 
                normalizedTorrentTitle.includes(word)
            );
            
            // Se almeno il 60% delle parole del titolo italiano sono presenti, è probabile che sia in italiano.
            const percentageMatch = matchingWords.length / italianWords.length;
            if (percentageMatch > 0.6) { // Soglia alzata per essere più precisi ed evitare falsi positivi
                console.log(`🇮🇹 Matched Italian title words in "${title}" (score: ${percentageMatch.toFixed(2)})`);
                return true;
            }
        }
    }

    return false;
}

// ✅ NUOVA FUNZIONE: Icona lingua
function getLanguageInfo(title, italianMovieTitle = null) {
    if (!title) return { icon: '', isItalian: false };

    const lowerTitle = title.toLowerCase();

    // Check for multi-language first
    if (/\b(multi|dual)\b/i.test(lowerTitle)) {
        return { icon: '🌈 ', isItalian: false, isMulti: true }; // Rainbow icon for multi-language
    }

    const isIta = isItalian(title, italianMovieTitle);
    return { icon: isIta ? '🇮🇹 ' : '', isItalian: isIta, isMulti: false };
}

// ✅ NUOVA FUNZIONE: Detecta Season Pack
function isSeasonPack(title) {
    if (!title) return false;
    const lowerTitle = title.toLowerCase();
    
    // Pattern per pack completi/multi-stagione
    const packPatterns = [
        /stagion[ei]\s*\d+\s*[-–—]\s*\d+/i,  // Stagione 1-34
        /season\s*\d+\s*[-–—]\s*\d+/i,       // Season 1-34
        /s\d+\s*[-–—]\s*s?\d+/i,             // S01-S34
        /completa/i,                          // Completa
        /complete/i,                          // Complete
        /integrale/i,                         // Integrale
        /collection/i,                        // Collection
        /\bpack\b/i                          // Pack
    ];
    
    return packPatterns.some(pattern => pattern.test(lowerTitle));
}

// ✅ NUOVA FUNZIONE: Filtro per categorie per adulti
function isAdultCategory(categoryText) {
    if (!categoryText) return false;
    // Normalize by converting to lowercase and removing common separators.
    const normalizedCategory = categoryText.toLowerCase().replace(/[\s/.-]/g, '');

    // Keywords that identify adult categories.
    const adultCategoryKeywords = ['xxxvideos', 'adult', 'porn', 'hardcore', 'erotic', 'hentai', 'stepmom', 'stepdad', 'stepsister', 'stepson', 'incest', 'eroz', 'foradults', 'mature', 'nsfw'];
    return adultCategoryKeywords.some(keyword => normalizedCategory.includes(keyword));
}

// ✅ NUOVA FUNZIONE: Validazione per query di ricerca brevi (Migliorata)
function isGoodShortQueryMatch(torrentTitle, searchQuery) {
    const cleanedSearchQuery = searchQuery
        .toLowerCase()
        .replace(/\s\(\d{4}\)/, '') // Rimuove l'anno tra parentesi
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ') // Keep unicode letters/numbers and dots/hyphens
        .replace(/\s+/g, ' ')
        .trim();

    // Applica il controllo solo per query brevi per non essere troppo restrittivo
    if (cleanedSearchQuery.length > 8 || cleanedSearchQuery.length < 2) { // Soglia aumentata
        return true;
    }

    const normalizedTorrentTitle = torrentTitle.toLowerCase();
    const searchWords = new Set(cleanedSearchQuery.split(' ').filter(w => w.length > 0));

    // 1. Tutte le parole della ricerca devono essere presenti nel titolo del torrent
    for (const word of searchWords) {
        const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
        if (!wordRegex.test(normalizedTorrentTitle)) {
            console.log(`🏴‍☠️ [Short Query] Parola mancante: "${word}" non trovata in "${torrentTitle}"`);
            return false;
        }
    }

    return true;
}

// --- NUOVA SEZIONE: SCRAPER PER IL CORSARO NERO ---

const CORSARO_BASE_URL = "https://ilcorsaronero.link";

async function fetchCorsaroNeroSingle(searchQuery, type = 'movie') {
    console.log(`🏴‍☠️ [Single Query] Searching Il Corsaro Nero for: "${searchQuery}" (type: ${type})`);

    try {
        // Definisce le categorie da accettare in base al tipo
        // Le categorie nel sito sono: "Film", "Serie TV", "Animazione - Film", "Animazione - Serie", "Musica - Audio", etc.
        let acceptedCategories;
        let outputCategory;
        switch (type) {
            case 'movie':
                acceptedCategories = ['film', 'animazione - film'];
                outputCategory = 'Movies';
                break;
            case 'series':
                acceptedCategories = ['serie tv', 'animazione - serie'];
                outputCategory = 'TV';
                break;
            case 'anime':
                // ⚠️ IMPORTANTE: Su CorsaroNero gli anime hanno categorie inconsistenti
                // Esempio: "One Piece S03E93-130" → "film", "One Piece S01E01-30" → "serie tv"
                // Accettiamo TUTTE le categorie e filtriamo poi per titolo/episodi
                acceptedCategories = ['animazione - film', 'animazione - serie', 'film', 'serie tv'];
                outputCategory = 'Anime';
                break;
            default:
                acceptedCategories = ['serie tv', 'animazione - serie'];
                outputCategory = 'TV';
        }
        
        // Cerca senza filtro categoria per avere tutti i risultati
        const searchUrl = `${CORSARO_BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`;
        
        const searchResponse = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        if (!searchResponse.ok) {
            throw new Error(`CorsaroNero search failed with status ${searchResponse.status}`);
        }
        const searchHtml = await searchResponse.text();

        const $ = cheerio.load(searchHtml);
        const rows = $('tbody tr');
        
        if (rows.length === 0) {
            console.log('🏴‍☠️ No results found on CorsaroNero.');
            return [];
        }

        // Check if it's the "no results" message
        if (rows.length === 1) {
            const firstCell = $(rows[0]).find('td').first();
            const text = firstCell.text().trim().toLowerCase();
            if (text.includes('nessun torrent') || text.includes('no torrent')) {
                console.log('🏴‍☠️ No results found on CorsaroNero (no torrent message).');
                return [];
            }
        }

        console.log(`🏴‍☠️ Found ${rows.length} potential results on CorsaroNero. Filtering by category...`);
        
        // Filtra le righe in base alla categoria
        const filteredRows = rows.toArray().filter((row) => {
            // Estrai la categoria dalla prima colonna
            const firstTd = $(row).find('td').first();
            const categorySpan = firstTd.find('span');
            const category = categorySpan.length > 0 
                ? categorySpan.text().trim().toLowerCase() 
                : firstTd.text().trim().toLowerCase();
            
            if (!category) {
                return false;
            }
            
            const isAccepted = acceptedCategories.includes(category);
            
            if (!isAccepted) {
                console.log(`🏴‍☠️   - Skipping category: "${category}"`);
            }
            
            return isAccepted;
        });
        
        console.log(`🏴‍☠️ After category filter: ${filteredRows.length} results (from ${rows.length} total)`);
        
        if (filteredRows.length === 0) {
            console.log('🏴‍☠️ No results found matching the category criteria.');
            return [];
        }
        
        // Limit the number of detail pages to fetch to avoid "Too many subrequests" error on Cloudflare.
        const MAX_DETAILS_TO_FETCH = 6;
        const rowsToProcess = filteredRows.slice(0, MAX_DETAILS_TO_FETCH);

        console.log(`🏴‍☠️ Fetching details for top ${rowsToProcess.length} results...`);

        const streamPromises = rowsToProcess.map(async (row) => {
            const titleElement = $(row).find('th a');
            if (!titleElement.length) return null;
            const torrentTitle = titleElement.text().trim();

            console.log(`🏴‍☠️   - Processing row: "${torrentTitle}"`);
            // --- NUOVA MODIFICA: Validazione per query brevi ---
            if (!isGoodShortQueryMatch(torrentTitle, searchQuery)) {
                return null;
            }
            // --- FINE MODIFICA ---

            const torrentPath = titleElement.attr('href');
            if (!torrentPath) return null;

            // --- OTTIMIZZAZIONE: Estrai la dimensione dalla pagina dei risultati ---
            const cells = $(row).find('td');
            const sizeStr = cells.length > 3 ? cells.eq(3).text().trim() : 'Unknown';
            const sizeInBytes = parseSize(sizeStr);
            // --- FINE OTTIMIZZAZIONE ---

            const torrentPageUrl = `${CORSARO_BASE_URL}${torrentPath}`;

            try {
                const detailResponse = await fetch(torrentPageUrl, { headers: { 'Referer': searchUrl } });
                if (!detailResponse.ok) return null;

                const detailHtml = await detailResponse.text();
                const $$ = cheerio.load(detailHtml);

                // --- MODIFICA: Logica di estrazione del magnet link più robusta ---
                let magnetLink = $$('a[href^="magnet:?"]').attr('href');
                
                // Fallback 1: Selettore specifico originale
                if (!magnetLink) {
                    const mainDiv = $$("div.w-full:nth-child(2)");
                    if (mainDiv.length) {
                        magnetLink = mainDiv.find("a.w-full:nth-child(1)").attr('href');
                    }
                }

                // Fallback 2: Cerca un link con un'icona a forma di magnete (comune)
                if (!magnetLink) {
                    magnetLink = $$('a:has(i.fa-magnet)').attr('href');
                }

                // Fallback 3: Search the entire page text for a magnet link pattern (very robust)
                if (!magnetLink) {
                    const bodyHtml = $$.html(); // Get the full HTML content of the page
                    // This regex looks for a magnet link inside quotes or as plain text.
                    const magnetMatch = bodyHtml.match(/["'>\s](magnet:\?xt=urn:btih:[^"'\s<>]+)/i);
                    if (magnetMatch && magnetMatch[1]) {
                        magnetLink = magnetMatch[1];
                        console.log('🏴‍☠️ [Magnet Fallback] Found magnet link using raw HTML search.');
                    }
                }
                // --- FINE MODIFICA ---
                
                if (magnetLink && magnetLink.startsWith('magnet:')) {
                    const seeds = $(row).find('td.text-green-500').text().trim() || '0';
                    const leechs = $(row).find('td.text-red-500').text().trim() || '0';
                    const infoHash = extractInfoHash(magnetLink);
                    
                    if (!infoHash) {
                        console.log(`🏴‍☠️   - Failed to extract infohash for: "${torrentTitle}"`);
                        return null;
                    }

                    return {
                        magnetLink: magnetLink,
                        websiteTitle: torrentTitle,
                        title: torrentTitle,
                        filename: torrentTitle,
                        quality: extractQuality(torrentTitle),
                        size: sizeStr,
                        source: 'CorsaroNero',
                        seeders: parseInt(seeds) || 0,
                        leechers: parseInt(leechs) || 0,
                        infoHash: infoHash,
                        mainFileSize: sizeInBytes,
                        pubDate: new Date().toISOString(), // Not available, using current time
                        categories: [outputCategory]
                    };
                }

                console.log(`🏴‍☠️   - Failed to find magnet for: "${torrentTitle}"`);
                return null;
            } catch (e) {
                console.error(`🏴‍☠️ Error fetching CorsaroNero detail page ${torrentPageUrl}:`, e.message);
                return null;
            }
        });

        const settledStreams = await Promise.allSettled(streamPromises);
        const streams = settledStreams
            .filter(result => result.status === 'fulfilled' && result.value)
            .map(result => result.value);

        console.log(`🏴‍☠️ Successfully parsed ${streams.length} streams from CorsaroNero.`);
        return streams;

    } catch (error) {
        console.error(`❌ Error in fetchCorsaroNeroData:`, error);
        return [];
    }
}

async function fetchCorsaroNeroData(originalQuery, type = 'movie') {
    const searchStrategies = [];

    // Strategy 1: Original query, cleaned
    const cleanedOriginal = cleanSearchQuery(originalQuery);
    if (cleanedOriginal) {
        searchStrategies.push({
            query: cleanedOriginal,
            description: 'Original cleaned'
        });
    }

    // Strategy 2: Remove extra words like "film", "movie", etc. (solo per film)
    if (type === 'movie') {
        const simplified = cleanedOriginal?.replace(/\b(movie|film|dvd|bluray|bd)\b/gi, '').trim();
        if (simplified && simplified !== cleanedOriginal && simplified.length > 2) {
            searchStrategies.push({
                query: simplified,
                description: 'Simplified movie'
            });
        }
    }

    let allResults = [];
    const seenHashes = new Set();

    for (const strategy of searchStrategies) {
        if (!strategy.query) continue;

        console.log(`🏴‍☠️ [Strategy: ${strategy.description}] Searching CorsaroNero for: "${strategy.query}"`);

        try {
            const results = await fetchCorsaroNeroSingle(strategy.query, type);
            const newResults = results.filter(result => {
                if (!result.infoHash || seenHashes.has(result.infoHash)) return false;
                seenHashes.add(result.infoHash);
                return true;
            });
            allResults.push(...newResults);
            if (allResults.length >= 20) break;
        } catch (error) {
            console.error(`❌ CorsaroNero Strategy "${strategy.description}" failed:`, error.message);
        }
    }
    
    console.log(`🏴‍☠️ Multi-strategy search for CorsaroNero found ${allResults.length} total unique results.`);
    return allResults;
}

// --- FINE NUOVA SEZIONE ---


// --- NUOVA SEZIONE: SCRAPER PER KNABEN.ORG ---

const KNABEN_BASE_URL = "https://knaben.org";

async function fetchKnabenData(searchQuery, type = 'movie') {
    // Knaben non ha categorie separate per film/serie nella ricerca, quindi 'type' è ignorato.
    const cleanedQuery = searchQuery.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!cleanedQuery) {
        console.log('🦉 Query is empty after cleaning, skipping Knaben search.');
        return [];
    }
    
    console.log(`🦉 [HTML Scraper] Searching Knaben.org for: "${cleanedQuery}"`);

    try {
        const searchUrl = `${KNABEN_BASE_URL}/search/${encodeURIComponent(cleanedQuery)}/`;
        
        const response = await fetch(searchUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Referer': `${KNABEN_BASE_URL}/`
            }
        });

        if (!response.ok) {
            throw new Error(`Knaben.org HTML search failed with status ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const rows = $('table.table tbody tr');
        if (rows.length === 0) {
            console.log('🦉 No results found on Knaben.org.');
            return [];
        }

        console.log(`🦉 Found ${rows.length} potential results on Knaben.org.`);

        const streams = rows.toArray().map(row => {
            const $row = $(row);

            const cells = $row.find('td');
            // --- NUOVA MODIFICA: Filtro per contenuti per adulti ---
            // Estrai la categoria dalla prima cella per il filtraggio.
            const torrentTitleForLog = $row.find('td:nth-child(2) a[title]').first().text().trim();
            const categoryText = cells.eq(0).text().trim();
            if (isAdultCategory(categoryText) || isAdultCategory(torrentTitleForLog)) {
                // Usiamo un selettore temporaneo per ottenere il titolo solo per il logging,
                // nel caso in cui questo risultato venga scartato.
                console.log(`🦉 Filtering adult content by category: "${torrentTitleForLog}" (Category: ${categoryText})`);
                return null; // Scarta il risultato
            }
            // --- FINE MODIFICA ---


            // Trova il titolo dall'attributo 'title' del primo link principale nella seconda cella.
            const titleElement = $row.find('td:nth-child(2) a[title]').first();
            const torrentTitle = titleElement.text().trim();

            // Trova il magnet link cercando un link che inizi con 'magnet:?' nella riga.
            const magnetElement = $row.find('a[href^="magnet:?"]').first();
            const magnetLink = magnetElement.attr('href');

            // Se non troviamo titolo o magnet, la riga non è valida.
            // Questo gestisce anche le righe che hanno solo un link "Refresh magnet".
            if (!torrentTitle || !magnetLink) return null;

            const infoHash = extractInfoHash(magnetLink);
            if (!infoHash) return null;

            // Estrai gli altri dati dalle celle corrispondenti.
            const sizeStr = cells.eq(2).text().trim();
            const seeds = cells.eq(4).text().trim(); // 5th column
            const leechs = cells.eq(5).text().trim(); // 6th column
            const sizeInBytes = parseSize(sizeStr);

            return {
                magnetLink: magnetLink,
                websiteTitle: torrentTitle,
                title: torrentTitle,
                filename: torrentTitle,
                quality: extractQuality(torrentTitle),
                size: sizeStr,
                source: 'Knaben',
                seeders: parseInt(seeds) || 0,
                leechers: parseInt(leechs) || 0,
                infoHash: infoHash.toUpperCase(),
                mainFileSize: sizeInBytes,
                pubDate: new Date().toISOString(), // Not available
                categories: [type === 'movie' ? 'Movies' : 'TV'] // Assume category from search type
            };
        }).filter(Boolean);

        console.log(`🦉 Successfully parsed ${streams.length} streams from Knaben.org.`);
        return streams;

    } catch (error) {
        console.error(`❌ Error in fetchKnabenData (HTML Scraper):`, error);
        return [];
    }
}

// --- FINE NUOVA SEZIONE ---

// --- NUOVA SEZIONE: JACKETTIO INTEGRATION ---

class Jackettio {
    constructor(baseUrl, apiKey, password = null) {
        // Use Torznab endpoint like the reference code
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = apiKey;
        this.password = password; // Optional password for authenticated instances
    }

    async search(query, category = null, italianOnly = false) {
        if (!query) return [];
        
        try {
            // Use Torznab API endpoint as per reference code
            // Format: /api/v2.0/indexers/all/results/torznab/api
            const torznabUrl = `${this.baseUrl}/api/v2.0/indexers/all/results/torznab/api`;
            
            const params = new URLSearchParams({
                apikey: this.apiKey,
                t: 'search', // Torznab search type
                q: query,
                limit: '100', // Request more results
                extended: '1' // Get extended attributes
            });
            
            // Add category if specified (Torznab format)
            if (category) {
                params.append('cat', category);
            }
            
            const url = `${torznabUrl}?${params}`;
            
            console.log(`🔍 [Jackettio] Torznab search for: "${query}" (category: ${category || 'all'}) ${italianOnly ? '[ITALIAN ONLY]' : ''}`);
            
            const headers = {
                'User-Agent': 'ilcorsaroviola/2.0',
                'Accept': 'application/json, application/xml, text/xml'
            };
            
            // Add password if provided (for authenticated instances)
            if (this.password) {
                headers['Authorization'] = `Basic ${btoa(`api:${this.password}`)}`;
            }
            
            const response = await fetch(url, { headers });

            if (!response.ok) {
                console.error(`❌ [Jackettio] API error: ${response.status} ${response.statusText}`);
                const errorText = await response.text().catch(() => 'Unable to read error');
                console.error(`❌ [Jackettio] Error response: ${errorText.substring(0, 500)}`);
                throw new Error(`Jackettio API error: ${response.status}`);
            }

            const contentType = response.headers.get('content-type') || '';
            let results = [];
            
            // Jackett can return JSON or XML depending on configuration
            if (contentType.includes('application/json')) {
                const data = await response.json();
                results = data.Results || [];
            } else {
                // Parse XML response (Torznab default)
                const xmlText = await response.text();
                results = this.parseXmlResults(xmlText);
            }
            
            if (results.length === 0) {
                console.log('🔍 [Jackettio] No results found.');
                return [];
            }

            console.log(`🔍 [Jackettio] Found ${results.length} raw results.`);
            
            // Parse Jackett results to our standard format
            const streams = results.map(result => {
                // Jackett può restituire sia magnet che torrent file
                let magnetLink = result.MagnetUri || result.magneturl || result.Link;
                
                // Se è un .torrent file, prova a estrarre l'hash
                if (!magnetLink || !magnetLink.startsWith('magnet:')) {
                    console.log(`⚠️ [Jackettio] Skipping non-magnet result: ${result.Title || result.title || 'Unknown'}`);
                    return null;
                }

                const title = result.Title || result.title || '';
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) {
                    console.log(`⚠️ [Jackettio] Failed to extract hash from: ${title}`);
                    return null;
                }

                // ✅ FILTER: Italian only check
                if (italianOnly && !isItalian(title)) {
                    console.log(`🚫 [Jackettio] Skipping non-Italian: ${title}`);
                    return null;
                }

                // Parse seeders/peers
                const seeders = result.Seeders || result.seeders || 0;
                const leechers = result.Peers || result.peers || 0;
                
                // Parse size
                const sizeInBytes = result.Size || result.size || 0;
                const sizeStr = formatBytes(sizeInBytes);

                // Determine category
                let outputCategory = 'Unknown';
                const categoryDesc = (result.CategoryDesc || result.category || '').toLowerCase();
                if (categoryDesc.includes('movie')) {
                    outputCategory = 'Movies';
                } else if (categoryDesc.includes('tv') || categoryDesc.includes('series')) {
                    outputCategory = 'TV';
                } else if (categoryDesc.includes('anime')) {
                    outputCategory = 'Anime';
                }

                return {
                    magnetLink: magnetLink,
                    websiteTitle: title,
                    title: title,
                    filename: title,
                    quality: extractQuality(title),
                    size: sizeStr,
                    source: 'Jackettio',
                    seeders: seeders,
                    leechers: leechers,
                    infoHash: infoHash,
                    mainFileSize: sizeInBytes,
                    pubDate: result.PublishDate || result.publishDate || new Date().toISOString(),
                    categories: [outputCategory]
                };
            }).filter(Boolean);

            console.log(`🔍 [Jackettio] Successfully parsed ${streams.length} ${italianOnly ? 'ITALIAN ' : ''}streams.`);
            return streams;

        } catch (error) {
            console.error(`❌ [Jackettio] Search failed:`, error.message);
            return [];
        }
    }
    
    // Parse XML response from Torznab API
    parseXmlResults(xmlText) {
        try {
            const $ = cheerio.load(xmlText, { xmlMode: true });
            const items = [];
            
            $('item').each((i, elem) => {
                const $item = $(elem);
                const $enclosure = $item.find('enclosure').first();
                
                const result = {
                    Title: $item.find('title').text(),
                    Link: $item.find('link').text(),
                    Size: parseInt($enclosure.attr('length')) || 0,
                    PublishDate: $item.find('pubDate').text(),
                    CategoryDesc: $item.find('category').text(),
                };
                
                // Extract torznab attributes
                $item.find('torznab\\:attr, attr').each((j, attr) => {
                    const $attr = $(attr);
                    const name = $attr.attr('name');
                    const value = $attr.attr('value');
                    
                    if (name === 'magneturl') result.MagnetUri = value;
                    if (name === 'seeders') result.Seeders = parseInt(value) || 0;
                    if (name === 'peers') result.Peers = parseInt(value) || 0;
                    if (name === 'size') result.Size = parseInt(value) || result.Size;
                });
                
                items.push(result);
            });
            
            console.log(`🔍 [Jackettio] Parsed ${items.length} items from XML`);
            return items;
        } catch (error) {
            console.error('❌ [Jackettio] XML parsing failed:', error.message);
            return [];
        }
    }
}

async function fetchJackettioData(searchQuery, type = 'movie', jackettioInstance = null) {
    if (!jackettioInstance) {
        console.log('⚠️ [Jackettio] Instance not configured, skipping.');
        return [];
    }

    try {
        // Map type to Jackett category codes
        let category = null;
        if (type === 'movie') {
            category = '2000'; // Movies
        } else if (type === 'series') {
            category = '5000'; // TV
        } else if (type === 'anime') {
            category = '5070'; // TV/Anime
        }

        // ✅ ONLY ITALIAN RESULTS
        const results = await jackettioInstance.search(searchQuery, category, true);
        return results;

    } catch (error) {
        console.error(`❌ Error in fetchJackettioData:`, error);
        return [];
    }
}

// --- FINE NUOVA SEZIONE ---

// ✅ Advanced HTML Parsing (inspired by JSDOM approach in uiai.js)
function parseUIndexHTML(html) {
    const results = [];
    
    // Split by table rows and filter for torrent rows
    const rows = html.split(/<tr[^>]*>/gi).filter(row => 
        row.includes('magnet:?xt=urn:btih:') && 
        row.includes('<td')
    );
    
    console.log(`📊 Processing ${rows.length} potential torrent rows`);
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        try {
            // Extract magnet link with better regex
            const magnetMatch = row.match(/href=["'](magnet:\?xt=urn:btih:[^"']+)["']/i);
            if (!magnetMatch) continue;
            
            let magnetLink = decodeHtmlEntities(magnetMatch[1]);
            
            // Parse table cells more reliably
            const cellRegex = /<td[^>]*>(.*?)<\/td>/gis;
            const cells = [];
            let cellMatch;
            
            while ((cellMatch = cellRegex.exec(row)) !== null) {
                cells.push(cellMatch[1].trim());
            }
            
            if (cells.length < 3) continue;
            
            // Extract title - try multiple patterns
            let title = "";
            const titleCell = cells[1] || "";
            
            // Pattern 1: details.php link
            const detailsMatch = titleCell.match(/<a[^>]*href=["']\/details\.php[^"']*["'][^>]*>([^<]+)<\/a>/i);
            if (detailsMatch) {
                title = detailsMatch[1].trim();
            } else {
                // Pattern 2: Second anchor tag
                const anchors = titleCell.match(/<a[^>]*>([^<]+)<\/a>/gi);
                if (anchors && anchors.length >= 2) {
                    const secondAnchor = anchors[1].match(/>([^<]+)</);
                    if (secondAnchor) title = secondAnchor[1].trim();
                } else if (anchors && anchors.length === 1) {
                    const singleAnchor = anchors[0].match(/>([^<]+)</);
                    if (singleAnchor) title = singleAnchor[1].trim();
                }
            }
            
            // Clean title
            title = decodeHtmlEntities(title);
            
            // Extract size from third cell
            let sizeStr = "Unknown";
            const sizeCell = cells[2] || "";
            const sizeMatch = sizeCell.match(/([\d.,]+\s*(?:B|KB|MB|GB|TB|KiB|MiB|GiB|TiB))/i);
            if (sizeMatch) {
                sizeStr = sizeMatch[1].trim();
            }
            
            // Extract category
            let category = "Unknown";
            const categoryCell = cells[0] || "";
            const categoryMatch = categoryCell.match(/<a[^>]*>([^<]+)<\/a>/i);
            if (categoryMatch) {
                category = decodeHtmlEntities(categoryMatch[1].trim());
            }
            
            // Extract seeders/leechers if available (usually in later cells)
            let seeders = 0, leechers = 0;
            if (cells.length > 4) {
                const seedMatch = cells[4]?.match(/(\d+)/);
                if (seedMatch) seeders = parseInt(seedMatch[1]);
            }
            if (cells.length > 5) {
                const leechMatch = cells[5]?.match(/(\d+)/);
                if (leechMatch) leechers = parseInt(leechMatch[1]);
            }
            
            // Skip if essential data is missing
            if (!title || title.length < 3 || !magnetLink) continue;
            
            const sizeInBytes = parseSize(sizeStr);
            const infoHash = extractInfoHash(magnetLink);
            
            if (!infoHash) {
                console.log(`⚠️ Skipping result without valid info hash: ${title}`);
                continue;
            }
            
            results.push({
                magnetLink,
                title,
                size: sizeStr,
                category,
                quality: extractQuality(title),
                infoHash,
                seeders,
                leechers,
                sizeInBytes,
                source: 'UIndex'
            });
            
            console.log(`✅ Parsed: ${title} (${sizeStr}) - ${infoHash}`);
            
        } catch (error) {
            console.error(`❌ Error parsing row ${i}:`, error.message);
            continue;
        }
    }
    
    console.log(`📊 Successfully parsed ${results.length} torrents`);
    return results;
}

// ✅ Multi-Strategy Search (try different query variations)
async function searchUIndexMultiStrategy(originalQuery, type = 'movie') {
    const searchStrategies = [];
    
    // Strategy 1: Original query
    const cleanedOriginal = cleanSearchQuery(originalQuery);
    if (cleanedOriginal) {
        searchStrategies.push({
            query: cleanedOriginal,
            description: 'Original cleaned'
        });
    }
    
    // Strategy 2: Remove extra words for movies
    if (type === 'movie') {
        const simplified = cleanedOriginal?.replace(/\b(movie|film|dvd|bluray|bd)\b/gi, '').trim();
        if (simplified && simplified !== cleanedOriginal) {
            searchStrategies.push({
                query: simplified,
                description: 'Simplified movie'
            });
        }
    }
    
    // Strategy 3: For series, try alternative episode format
    if (type === 'series' && originalQuery.includes('S') && originalQuery.includes('E')) {
        const altFormat = originalQuery.replace(/S(\d+)E(\d+)/i, '$1x$2');
        if (altFormat !== originalQuery) {
            searchStrategies.push({
                query: cleanSearchQuery(altFormat),
                description: 'Alternative episode format'
            });
        }
    }
    
    let allResults = [];
    const seenHashes = new Set();
    
    for (const strategy of searchStrategies) {
        if (!strategy.query) continue;
        
        console.log(`🔍 Trying strategy: ${strategy.description} - "${strategy.query}"`);
        
        try {
            const results = await fetchUIndexSingle(strategy.query, type);
            
            // Deduplicate by info hash
            const newResults = results.filter(result => {
                if (!result.infoHash || seenHashes.has(result.infoHash)) return false;
                seenHashes.add(result.infoHash);
                return true;
            });
            
            console.log(`📊 Strategy "${strategy.description}" found ${newResults.length} unique results`);
            allResults.push(...newResults);
            
            // If we got good results, don't try too many more strategies
            if (allResults.length >= 20) break;
            
        } catch (error) {
            console.error(`❌ Strategy "${strategy.description}" failed:`, error.message);
            continue;
        }
        
        // Delay between strategies to avoid rate limiting (429 errors)
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    
    console.log(`🎉 Multi-strategy search found ${allResults.length} total unique results`);
    return allResults;
}

// ✅ Single UIndex Search with Enhanced Error Handling
async function fetchUIndexSingle(searchQuery, type = 'movie') {
    try {
        console.log(`🔍 Searching UIndex for: "${searchQuery}" (type: ${type})`);
        
        let category = 0; // Default to 'All'
        if (type === 'movie') {
            category = 1; // Movie category
        } else if (type === 'series') {
            category = 2; // TV category
        } else if (type === 'anime') {
            category = 7; // Anime category
        }

        const searchUrl = `https://uindex.org/search.php?search=${encodeURIComponent(searchQuery)}&c=${category}`;
        
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Cache-Control': 'no-cache'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        
        // Basic validation
        if (!html.includes('<table') || !html.includes('magnet:')) {
            console.log('⚠️ Page doesn\'t contain expected torrent table');
            return [];
        }
        
        return parseUIndexHTML(html);
        
    } catch (error) {
        console.error(`❌ Error fetching from UIndex:`, error);
        return [];
    }
}

// ✅ Enhanced Result Processing and Sorting
function processAndSortResults(results, italianTitle = null) {
    // Filter out invalid results
    const validResults = results.filter(result => 
        result.title && 
        result.title.length > 3 && 
        result.infoHash && 
        result.infoHash.length >= 32
    );
    
    // Sort by Italian, then quality, then by size, then by seeders
    validResults.sort((a, b) => {
        // ✅ MODIFICA: Usa la nuova logica unificata
        const aLang = getLanguageInfo(a.title, italianTitle);
        const bLang = getLanguageInfo(b.title, italianTitle);

        if (aLang.isItalian !== bLang.isItalian) return aLang.isItalian ? -1 : 1;
        if (aLang.isMulti !== bLang.isMulti) return aLang.isMulti ? -1 : 1;
        const qualityOrder = { 
            '2160p': 6, '4k': 6, 'uhd': 6,
            'remux': 5,
            '1080p': 4, 
            '720p': 3, 
            'webrip': 2,
            '480p': 1,
            'cam': 0, 'ts': 0, 'tc': 0
        };
        
        const qualityDiff = (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        if (qualityDiff !== 0) return qualityDiff;
        
        // Then by file size
        const sizeDiff = (b.sizeInBytes || 0) - (a.sizeInBytes || 0);
        if (sizeDiff !== 0) return sizeDiff;
        
        // Finally by seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });
    
    return validResults;
}

// ✅ Sorting by Quality and Seeders
function sortByQualityAndSeeders(results) {
    results.sort((a, b) => {
        const qualityOrder = { 
            '2160p': 6, '4k': 6, 'uhd': 6,
            'remux': 5,
            '1080p': 4, 
            '720p': 3, 
            'webrip': 2,
            '480p': 1,
            'cam': 0, 'ts': 0, 'tc': 0
        };
        
        const qualityDiff = (qualityOrder[b.quality] || 0) - (qualityOrder[a.quality] || 0);
        if (qualityDiff !== 0) return qualityDiff;
        
        // Finally by seeders
        return (b.seeders || 0) - (a.seeders || 0);
    });
    return results;
}

// ✅ NUOVA FUNZIONE: Limita i risultati per qualità
function limitResultsByQuality(results, limit = 3) {
    const qualityCounts = {};
    const limitedResults = [];

    // L'array `results` in input deve essere pre-ordinato
    for (const result of results) {
        // Normalizza la qualità. Usa 'unknown' per qualità vuote.
        const quality = result.quality || 'unknown';
        
        if (qualityCounts[quality] === undefined) {
            qualityCounts[quality] = 0;
        }

        if (qualityCounts[quality] < limit) {
            limitedResults.push(result);
            qualityCounts[quality]++;
        }
    }
    
    console.log(`Limiting by quality: reduced ${results.length} to ${limitedResults.length} results.`);
    return limitedResults;
}

// ✅ NUOVA FUNZIONE: Limita i risultati per lingua e qualità
function limitResultsByLanguageAndQuality(results, italianLimit = 5, otherLimit = 2) {
    const italianResults = [];
    const otherResults = [];

    // Separa i risultati italiani dagli altri
    for (const result of results) {
        // Usiamo la funzione getLanguageInfo per coerenza con il resto dell'app
        const { isItalian, isMulti } = getLanguageInfo(result.title, null); // italianMovieTitle non è disponibile qui
        if (isItalian || isMulti) { // Tratta sia ITA che MULTI come prioritari
            italianResults.push(result);
        } else {
            otherResults.push(result);
        }
    }

    // Applica il limite per qualità a ciascun gruppo
    // L'array in input è già ordinato per qualità e seeders
    const limitedItalian = limitResultsByQuality(italianResults, italianLimit);
    const limitedOther = limitResultsByQuality(otherResults, otherLimit);

    // Riunisci i risultati, mantenendo la priorità (italiano prima)
    const finalResults = [...limitedItalian, ...limitedOther];

    console.log(`Limiting by language: reduced ${results.length} to ${finalResults.length} (ITA: ${limitedItalian.length}, Other: ${limitedOther.length})`);
    
    // Riordina per sicurezza, anche se i gruppi sono già ordinati internamente
    return sortByQualityAndSeeders(finalResults);
}

// ✅ Funzione di logging asincrona che non blocca la risposta
async function logRequest(request, response, duration) {
    const { method } = request;
    const url = new URL(request.url);
    const { status } = response;
    const logData = {
        timestamp: new Date().toISOString(),
        method: request.method,
        url: url.pathname,
        status: response.status,
        durationMs: duration,
        // Vercel specific headers
        vercelId: request.headers['x-vercel-id'] || 'N/A',
        vercelCountry: request.headers['x-vercel-ip-country'] || 'N/A',
    };

    console.log(`[Analytics Log Sent]: ${JSON.stringify(logData)}`);
}


// ✅ Real-Debrid API integration
class RealDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
    }

    // 🔥 Torrentio-style Error Handlers
    _isAccessDeniedError(error) {
        return error && [9, 12, 13, 18].includes(error.error_code);
    }

    _isInfringingFileError(error) {
        return error && [20, 29].includes(error.error_code);
    }

    _isLimitExceededError(error) {
        return error && error.error_code === 31;
    }

    _isTorrentTooBigError(error) {
        return error && error.error_code === 32;
    }

    _isFailedDownloadError(error) {
        return error && [16, 19, 21, 22, 23, 25, 26, 27].includes(error.error_code);
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        const batchSize = 40; // RD API limit: max 40 hashes per request
        
        console.log(`🔵 RD Cache check: ${hashes.length} hashes (${Math.ceil(hashes.length / batchSize)} batches)`);
        
        for (let i = 0; i < hashes.length; i += batchSize) {
            const batch = hashes.slice(i, i + batchSize);
            const url = `${this.baseUrl}/torrents/instantAvailability/${batch.join('/')}`;

            try {
                console.log(`🔵 [RD Debug] Request URL: ${url}`);
                console.log(`🔵 [RD Debug] API Key length: ${this.apiKey.length}`);
                console.log(`🔵 [RD Debug] Batch hashes: ${batch.join(', ')}`);
                
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'User-Agent': 'Stremio/1.0'
                    },
                    signal: AbortSignal.timeout(15000) // 15s timeout
                });

                if (!response.ok) {
                    const errorBody = await response.text().catch(() => 'Unable to read error body');
                    console.error(`❌ RD Cache API error: ${response.status} ${response.statusText}`);
                    console.error(`❌ RD Error body: ${errorBody}`);
                    // Mark all batch as not cached on API error
                    batch.forEach(hash => {
                        results[hash.toLowerCase()] = { 
                            cached: false, 
                            variants: [],
                            downloadLink: null, 
                            service: 'Real-Debrid',
                            error: `API Error ${response.status}`
                        };
                    });
                    continue;
                }

                const data = await response.json();

                batch.forEach(hash => {
                    const hashLower = hash.toLowerCase();
                    const cacheInfo = data[hashLower];
                    
                    // ✅ EXACT TORRENTIO LOGIC: Consider cached if RD has ANY variant available
                    // Torrentio checks: cacheInfo && cacheInfo.rd && cacheInfo.rd.length > 0
                    const variants = cacheInfo?.rd || [];
                    const isCached = variants.length > 0;
                    
                    results[hashLower] = {
                        cached: isCached,
                        variants: variants,  // Array of available variants (each with files info)
                        variantsCount: variants.length,  // Number of cached variants
                        downloadLink: null,  // Not needed, /rd-stream handles unrestricting
                        service: 'Real-Debrid'
                    };
                    
                    if (isCached) {
                        console.log(`✅ RD Cache HIT: ${hashLower.substring(0, 8)}... (${variants.length} variants)`);
                    }
                });

                // Rate limiting: 500ms between batches to avoid API blocks
                if (i + batchSize < hashes.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error(`❌ RD Cache check failed for batch ${i / batchSize + 1}:`, error.message);
                // Mark all batch as not cached on error
                batch.forEach(hash => {
                    results[hash.toLowerCase()] = { 
                        cached: false, 
                        variants: [],
                        downloadLink: null, 
                        service: 'Real-Debrid',
                        error: error.message
                    };
                });
            }
        }

        const cachedCount = Object.values(results).filter(r => r.cached).length;
        console.log(`🔵 RD Cache check complete: ${cachedCount}/${hashes.length} cached`);

        return results;
    }

    // 🔥 Torrentio-style: Find Existing Torrent (evita duplicati)
    async _findExistingTorrent(infoHash) {
        try {
            const response = await fetch(`${this.baseUrl}/torrents`, {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            
            if (!response.ok) return null;
            
            const torrents = await response.json();
            const existing = torrents.find(t => 
                t.hash && t.hash.toLowerCase() === infoHash.toLowerCase() && 
                t.status !== 'error'
            );
            
            if (existing) {
                console.log(`♻️ [RD] Reusing existing torrent: ${existing.id} (${existing.status})`);
            }
            
            return existing;
        } catch (error) {
            console.warn(`⚠️ Failed to check existing torrents: ${error.message}`);
            return null;
        }
    }

    async addMagnet(magnetLink, force = false) {
        const formData = new FormData();
        formData.append('magnet', magnetLink);

        const response = await fetch(`${this.baseUrl}/torrents/addMagnet`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw errorData; // Return full error object for retry logic
        }

        return await response.json();
    }

    // 🔥 Torrentio-style: Retry with force flag on failure
    async _retryCreateTorrent(infoHash, magnetLink) {
        try {
            console.log(`🔄 [RD] Retrying torrent creation with force flag...`);
            
            // Delete any existing error torrents
            const torrents = await this.getTorrents();
            const errorTorrents = torrents.filter(t => 
                t.hash && t.hash.toLowerCase() === infoHash.toLowerCase() && 
                t.status === 'error'
            );
            
            for (const torrent of errorTorrents) {
                await this.deleteTorrent(torrent.id);
                console.log(`🗑️ [RD] Deleted error torrent: ${torrent.id}`);
            }
            
            // Retry with force flag (if RD API supports it)
            const result = await this.addMagnet(magnetLink, true);
            console.log(`✅ [RD] Retry successful: ${result.id}`);
            return result;
        } catch (retryError) {
            console.error(`❌ [RD] Retry failed:`, retryError);
            throw retryError;
        }
    }

    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Real-Debrid: ${response.status}`);
        }
        return await response.json();
    }

    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/delete/${torrentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (response.status !== 204) {
            console.error(`Failed to delete torrent ${torrentId} from Real-Debrid.`);
        }
    }

    async selectFiles(torrentId, fileIds = 'all') {
        const formData = new FormData();
        formData.append('files', fileIds);

        const response = await fetch(`${this.baseUrl}/torrents/selectFiles/${torrentId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            body: formData
        });

        // Status 204 = success
        if (response.status === 204) {
            return;
        }
        
        // Status 202 with "action_already_done" = files already selected, treat as success
        if (response.status === 202) {
            const errorData = await response.json().catch(() => ({}));
            if (errorData.error === 'action_already_done') {
                console.log('ℹ️ [RD] Files already selected (202 action_already_done), continuing...');
                return;
            }
        }
        
        // Any other status = error
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Failed to select files on Real-Debrid: ${response.status} - ${errorData.error || 'Unknown error'}`);
    }

    async getTorrentInfo(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/info/${torrentId}`, {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`Failed to get torrent info from Real-Debrid: ${response.status}`);
        }
        return await response.json();
    }

    async unrestrictLink(link) {
        const formData = new FormData();
        formData.append('link', link);

        const response = await fetch(`${this.baseUrl}/unrestrict/link`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Real-Debrid API error: ${response.status}`);
        }

        return await response.json();
    }
}

// ✅ Torbox API integration
class Torbox {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.torbox.app/v1/api';
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        
        // Torbox supports bulk check via POST
        try {
            const response = await fetch(`${this.baseUrl}/torrents/checkcached`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    hashes: hashes,
                    format: 'object',
                    list_files: true
                })
            });

            if (!response.ok) {
                throw new Error(`Torbox API error: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success && data.data) {
                hashes.forEach(hash => {
                    const cacheInfo = data.data[hash.toLowerCase()];
                    
                    // ✅ TORBOX API LOGIC: If hash is present in response data, it's cached
                    // Torbox API returns the hash entry ONLY if it's in cache
                    // If not in cache, the hash won't be in the response
                    const isCached = !!cacheInfo;  // Present = cached
                    
                    results[hash.toLowerCase()] = {
                        cached: isCached,  // Simple presence check
                        downloadLink: null,  // Not needed, /torbox-stream handles everything
                        service: 'Torbox'
                    };
                });
            }
        } catch (error) {
            console.error('Torbox cache check failed:', error);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { cached: false, downloadLink: null, service: 'Torbox' };
            });
        }
        
        return results;
    }

    async addTorrent(magnetLink) {
        // Use URLSearchParams exactly like Torrentio
        const data = new URLSearchParams();
        data.append('magnet', magnetLink);
        data.append('allow_zip', 'false'); // Don't allow zip files
        
        const response = await fetch(`${this.baseUrl}/torrents/createtorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: data.toString()
        });

        const responseData = await response.json();
        
        // Handle errors gracefully
        if (!response.ok) {
            // If it's a 400, it might be because torrent is not cached
            // Return error details so we can handle it upstream
            throw new Error(`Torbox API error: ${response.status} - ${responseData.error || responseData.detail || 'Unknown error'}`);
        }

        if (!responseData.success) {
            throw new Error(`Torbox error: ${responseData.error || 'Unknown error'}`);
        }
        
        return responseData.data;
    }

    async getTorrents() {
        const response = await fetch(`${this.baseUrl}/torrents/mylist`, {
            headers: { 
                'Authorization': `Bearer ${this.apiKey}` 
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get torrents list from Torbox: ${response.status}`);
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || 'Unknown error'}`);
        }
        
        return data.data || [];
    }

    async deleteTorrent(torrentId) {
        const response = await fetch(`${this.baseUrl}/torrents/controltorrent`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                torrent_id: torrentId,
                operation: 'delete'
            })
        });

        const data = await response.json();
        if (!data.success) {
            console.error(`Failed to delete torrent ${torrentId} from Torbox.`);
        }
    }

    async getTorrentInfo(torrentId) {
        const torrents = await this.getTorrents();
        const torrent = torrents.find(t => t.id === parseInt(torrentId));
        
        if (!torrent) {
            throw new Error(`Torrent ${torrentId} not found in Torbox`);
        }
        
        return torrent;
    }

    async createDownload(torrentId, fileId = null) {
        // Torbox uses /torrents/requestdl endpoint to get download links
        // If fileId is provided, get specific file, otherwise get whole torrent
        const params = new URLSearchParams({
            token: this.apiKey,
            torrent_id: torrentId
        });
        
        if (fileId) {
            params.append('file_id', fileId);
        }
        
        params.append('zip_link', 'false');

        const response = await fetch(`${this.baseUrl}/torrents/requestdl?${params}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Torbox requestdl error (${response.status}):`, errorText);
            throw new Error(`Torbox API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.success) {
            throw new Error(`Torbox error: ${data.error || data.detail || 'Unknown error'}`);
        }
        
        // Torbox returns direct download URL in data field
        return data.data; // Returns direct download URL string
    }
}

// ✅ AllDebrid API integration
class AllDebrid {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.alldebrid.com/v4';
    }

    async checkCache(hashes) {
        if (!hashes || hashes.length === 0) return {};
        
        const results = {};
        
        try {
            // AllDebrid uses /magnet/instant endpoint
            const magnets = hashes.map(h => `magnet:?xt=urn:btih:${h}`);
            const url = `${this.baseUrl}/magnet/instant?agent=stremio&apikey=${this.apiKey}`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ magnets })
            });
            
            const data = await response.json();
            
            if (response.ok && data.status === 'success') {
                const magnetData = data.data.magnets || [];
                
                magnetData.forEach((item, index) => {
                    const hash = hashes[index]?.toLowerCase();
                    if (!hash) return;
                    
                    // AllDebrid returns instant: true if cached
                    results[hash] = {
                        cached: item.instant === true,
                        service: 'AllDebrid'
                    };
                });
            }
        } catch (error) {
            console.error('AllDebrid cache check failed:', error);
            hashes.forEach(hash => {
                results[hash.toLowerCase()] = { cached: false, service: 'AllDebrid' };
            });
        }
        
        return results;
    }

    async uploadMagnet(magnetLink) {
        const url = `${this.baseUrl}/magnet/upload?agent=stremio&apikey=${this.apiKey}`;
        
        const formData = new URLSearchParams();
        formData.append('magnets[]', magnetLink);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`AllDebrid API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status !== 'success') {
            throw new Error(`AllDebrid error: ${data.error?.message || 'Unknown error'}`);
        }
        
        // Returns { id: magnetId }
        return data.data.magnets[0];
    }

    async getMagnetStatus(magnetId) {
        const url = `${this.baseUrl}/magnet/status?agent=stremio&apikey=${this.apiKey}&id=${magnetId}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`AllDebrid API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status !== 'success') {
            throw new Error(`AllDebrid error: ${data.error?.message || 'Unknown error'}`);
        }
        
        return data.data.magnets;
    }

    async unlockLink(link) {
        const url = `${this.baseUrl}/link/unlock?agent=stremio&apikey=${this.apiKey}&link=${encodeURIComponent(link)}`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`AllDebrid API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status !== 'success') {
            throw new Error(`AllDebrid error: ${data.error?.message || 'Unknown error'}`);
        }
        
        return data.data.link;
    }
}

// ✅ Debrid Service Factory - Supports RealDebrid, Torbox, and AllDebrid
function createDebridServices(config) {
    const services = {
        realdebrid: null,
        torbox: null,
        alldebrid: null,
        useRealDebrid: false,
        useTorbox: false,
        useAllDebrid: false,
        mediaflowProxy: null // MediaFlow Proxy config (for RD sharing)
    };
    
    // Check RealDebrid
    if (config.use_rd && config.rd_key && config.rd_key.length > 5) {
        console.log('🔵 Real-Debrid enabled');
        services.realdebrid = new RealDebrid(config.rd_key);
        services.useRealDebrid = true;
    }
    
    // Check Torbox
    if (config.use_torbox && config.torbox_key && config.torbox_key.length > 5) {
        console.log('📦 Torbox enabled');
        services.torbox = new Torbox(config.torbox_key);
        services.useTorbox = true;
    }
    
    // Check AllDebrid
    if (config.use_alldebrid && config.alldebrid_key && config.alldebrid_key.length > 5) {
        console.log('🅰️ AllDebrid enabled');
        services.alldebrid = new AllDebrid(config.alldebrid_key);
        services.useAllDebrid = true;
    }
    
    // Check MediaFlow Proxy (for RD sharing)
    if (config.mediaflow_url && config.mediaflow_password) {
        console.log('🔀 MediaFlow Proxy enabled for RD sharing');
        services.mediaflowProxy = {
            url: config.mediaflow_url,
            password: config.mediaflow_password
        };
    }
    
    if (!services.useRealDebrid && !services.useTorbox && !services.useAllDebrid) {
        console.log('⚪ No debrid service enabled - using P2P mode');
    }
    
    return services;
}

// ✅ MediaFlow Proxy Helper - Using /generate_urls endpoint (like AIOStream)
async function proxyThroughMediaFlow(directUrl, mediaflowConfig, filename = null) {
    if (!mediaflowConfig || !mediaflowConfig.url) {
        return directUrl; // No proxy configured, return direct URL
    }
    
    try {
        // Extract filename from URL if not provided
        if (!filename) {
            const urlParts = directUrl.split('/');
            filename = urlParts[urlParts.length - 1] || 'stream.mkv';
            // Remove query params from filename
            filename = filename.split('?')[0];
        }
        
        const mediaflowUrl = mediaflowConfig.url.replace(/\/+$/, '');
        const generateUrlsEndpoint = `${mediaflowUrl}/generate_urls`;
        
        // Build request body exactly like AIOStream
        const requestBody = {
            mediaflow_proxy_url: mediaflowUrl,
            api_password: mediaflowConfig.password,
            urls: [{
                endpoint: '/proxy/stream',
                filename: filename,
                query_params: {
                    api_password: mediaflowConfig.password
                },
                destination_url: directUrl,
                request_headers: {},
                response_headers: {}
            }]
        };
        
        console.log(`🔀 Calling MediaFlow /generate_urls for: ${filename}`);
        
        // Call MediaFlow to generate proxy URL
        const response = await fetch(generateUrlsEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(10000)
        });
        
        if (!response.ok) {
            throw new Error(`MediaFlow returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (data.urls && data.urls.length > 0) {
            console.log(`✅ MediaFlow proxy URL generated successfully`);
            return data.urls[0]; // Return the generated MediaFlow proxy URL
        } else {
            throw new Error('No URLs returned from MediaFlow');
        }
        
    } catch (error) {
        console.error(`❌ MediaFlow proxy setup failed:`, error.message);
        return directUrl; // Fallback to direct URL on error
    }
}

// ✅ Helper functions (unchanged)
function getQualitySymbol(quality) {
    const qualityStr = String(quality).toLowerCase();
    
    if (qualityStr.includes('2160') || qualityStr.includes('4k') || qualityStr.includes('uhd')) {
        return '🔥';
    } else if (qualityStr.includes('1080')) {
        return '⭐';
    } else if (qualityStr.includes('720')) {
        return '✅';
    } else if (qualityStr.includes('480')) {
        return '📺';
    } else {
        return '🎬';
    }
}

function extractImdbId(id) {
    if (id.startsWith('tt')) return id;
    if (id.match(/^\d+$/)) return `tt${id}`;
    return null;
}

async function getTMDBDetailsByImdb(imdbId, tmdbApiKey) {
    try {
        const response = await fetch(`${TMDB_BASE_URL}/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`, {
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /find/${imdbId} error: ${response.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();
        
        if (data.movie_results?.[0]) {
            const movie = data.movie_results[0];
            const year = new Date(movie.release_date).getFullYear();
            return {
                title: movie.title,
                year: year,
                type: 'movie',
                imdbId: imdbId,  // ✅ FIX: Include imdbId
                tmdbId: movie.id
            };
        }
        
        if (data.tv_results?.[0]) {
            const show = data.tv_results[0];
            const year = new Date(show.first_air_date).getFullYear();
            return {
                title: show.name,
                year: year,
                type: 'series',
                imdbId: imdbId,  // ✅ FIX: Include imdbId
                tmdbId: show.id
            };
        }
        
        return null;
    } catch (error) {
        console.error('TMDB fetch error:', error);
        return null;
    }
}

// ✅ SOLUZIONE 2: Get details from TMDb ID (not IMDb)
async function getTMDBDetailsByTmdb(tmdbId, type, tmdbApiKey) {
    try {
        const mediaType = type === 'series' ? 'tv' : 'movie';
        const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`;
        
        console.log(`🔄 Fetching TMDb details for ${mediaType} ${tmdbId}...`);
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /${mediaType}/${tmdbId} error: ${response.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();
        
        const title = data.title || data.name;
        const releaseDate = data.release_date || data.first_air_date;
        const year = releaseDate ? new Date(releaseDate).getFullYear() : null;
        const imdbId = data.external_ids?.imdb_id || null;
        
        console.log(`✅ TMDb ${tmdbId} → ${title} (${year})${imdbId ? `, IMDb: ${imdbId}` : ''}`);
        
        return {
            title: title,
            year: year,
            type: type,
            tmdbId: tmdbId,
            imdbId: imdbId // ✅ Include IMDb from external_ids
        };
    } catch (error) {
        console.error(`❌ TMDB fetch error for ${type} ${tmdbId}:`, error);
        return null;
    }
}

// 🔥 NEW: Save CorsaroNero results we already found (no additional search needed!)
async function saveCorsaroResultsToDB(corsaroResults, mediaDetails, type, dbHelper, italianTitle = null) {
    try {
        console.log(`💾 [DB Save] Saving ${corsaroResults.length} CorsaroNero results...`);
        
        // 🔥 OPZIONE C: Se titolo breve (≤6 lettere, 1 parola), non filtrare query generiche
        const titleWords = mediaDetails.title.trim().split(/\s+/);
        const isShortTitle = titleWords.length === 1 && titleWords[0].length <= 6;
        console.log(`📏 [DB Save] Title "${mediaDetails.title}" - Short: ${isShortTitle}`);
        
        const torrentsToInsert = [];
        for (const result of corsaroResults) {
            if (!result.infoHash || result.infoHash.length < 32) {
                console.log(`⚠️ [DB Save] Skipping invalid hash: ${result.title}`);
                continue;
            }
            
            // 🔥 CHECK: Torrent già presente nel DB?
            // Note: batchInsertTorrents gestisce duplicati con ON CONFLICT DO UPDATE
            // quindi salverà gli ID mancanti
            
            // 🔥 OPZIONE B: Title matching con 85% threshold - CHECK BOTH ENGLISH & ITALIAN
            const normalizedTorrentTitle = result.title
                .replace(/<[^>]*>/g, '')
                .replace(/[\[.*?\]]/g, '')
                .replace(/\(.*?\)/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            
            // Helper function to check title match
            const checkTitleMatch = (titleToCheck) => {
                const normalizedTitle = titleToCheck
                    .toLowerCase()
                    .replace(/[^\w\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                const searchWords = normalizedTitle.split(' ')
                    .filter(word => word.length > 2)
                    .filter(word => !['the', 'and', 'or', 'in', 'on', 'at', 'to', 'of', 'for'].includes(word));
                
                if (searchWords.length === 0) return { matched: true, percentage: 100, titleUsed: titleToCheck };
                
                const matchingWords = searchWords.filter(word => 
                    normalizedTorrentTitle.includes(word)
                );
                const matchPercentage = matchingWords.length / searchWords.length;
                
                return { 
                    matched: matchPercentage >= 0.85, 
                    percentage: matchPercentage * 100,
                    titleUsed: titleToCheck
                };
            };
            
            // Try matching with English title first
            let matchResult = checkTitleMatch(mediaDetails.title);
            console.log(`🔍 [DB Save] English title match: ${matchResult.percentage.toFixed(0)}% for "${result.title.substring(0, 50)}..."`);
            
            // If English doesn't match and we have Italian title, try Italian
            if (!matchResult.matched && italianTitle && italianTitle !== mediaDetails.title) {
                const italianMatchResult = checkTitleMatch(italianTitle);
                console.log(`🔍 [DB Save] Italian title match: ${italianMatchResult.percentage.toFixed(0)}% for "${result.title.substring(0, 50)}..."`);
                if (italianMatchResult.matched) {
                    matchResult = italianMatchResult;
                    console.log(`🇮🇹 [DB Save] Using Italian title match: "${italianTitle}"`);
                }
            }
            
            if (!matchResult.matched && !isShortTitle) {
                console.log(`⏭️ [DB Save] SKIP: "${result.title}" (${matchResult.percentage.toFixed(0)}% match, need 85%)`);
                continue;
            }
            
            console.log(`✅ [DB Save] Title match: "${result.title}" (${matchResult.percentage.toFixed(0)}% match with "${matchResult.titleUsed}")`);
            
            // Extract IMDB ID from title if available
            const imdbMatch = result.title.match(/tt\d{7,8}/i);
            const imdbId = imdbMatch ? imdbMatch[0] : (mediaDetails.imdbId || null);
            
            console.log(`💾 [DB Save] Processing: ${result.title} - Size: ${result.size} (${result.mainFileSize} bytes), Seeders: ${result.seeders}`);
            
            torrentsToInsert.push({
                info_hash: result.infoHash.toLowerCase(),
                provider: 'CorsaroNero',
                title: result.title,
                size: result.mainFileSize || 0,
                type: type,
                upload_date: new Date().toISOString(),
                seeders: result.seeders || 0,
                imdb_id: imdbId,
                tmdb_id: mediaDetails.tmdbId || null,
                cached_rd: null,
                last_cached_check: null,
                file_index: null
            });
        }
        
        console.log(`📊 [DB Save] Prepared ${torrentsToInsert.length} torrents for insertion`);
        
        if (torrentsToInsert.length > 0) {
            console.log(`💾 [DB Save] Calling batchInsertTorrents with ${torrentsToInsert.length} torrents...`);
            const insertedCount = await dbHelper.batchInsertTorrents(torrentsToInsert);
            console.log(`✅ [DB Save] batchInsertTorrents returned: ${insertedCount} (inserted/updated count)`);
            console.log(`✅ [DB Save] Inserted ${insertedCount}/${torrentsToInsert.length} new torrents`);
        } else {
            console.log(`⚠️ [DB Save] No valid torrents to insert (all filtered out)`);
        }
    } catch (error) {
        console.error(`❌ [DB Save] Error:`, error);
    }
}

// 🔥 OLD: Background CorsaroNero enrichment - populates DB without blocking user response
async function enrichDatabaseInBackground(mediaDetails, type, season = null, episode = null, dbHelper, italianTitle = null, originalTitle = null) {
    try {
        console.log(`🔄 [Background] Starting CorsaroNero enrichment for: ${mediaDetails.title}`);
        console.log(`🔄 [Background] CODE VERSION: 2024-11-15-v2 (Italian title support)`);
        console.log(`🔄 [Background] Input: imdbId=${mediaDetails.imdbId}, tmdbId=${mediaDetails.tmdbId}, type=${type}`);
        
        // If we have IMDB but not TMDB, try to get TMDB ID
        if (mediaDetails.imdbId && !mediaDetails.tmdbId) {
            try {
                console.log(`🔄 [Background] Converting IMDb to TMDb...`);
                const tmdbKey = process.env.TMDB_KEY || process.env.TMDB_API_KEY || '5462f78469f3d80bf5201645294c16e4';
                const tmdbData = await getTMDBDetailsByImdb(mediaDetails.imdbId, tmdbKey);
                if (tmdbData && tmdbData.tmdbId) {
                    mediaDetails.tmdbId = tmdbData.tmdbId;
                    console.log(`🔄 [Background] Enriched TMDB ID: ${tmdbData.tmdbId} from IMDB: ${mediaDetails.imdbId}`);
                } else {
                    console.warn(`⚠️ [Background] TMDb conversion returned no data`);
                }
            } catch (error) {
                console.error(`❌ [Background] Error in TMDb conversion:`, error);
            }
        }
        
        // ✅ SOLUZIONE 1: If we have TMDB but not IMDB, try to get IMDB ID
        if (mediaDetails.tmdbId && !mediaDetails.imdbId) {
            try {
                console.log(`🔄 [Background] Converting TMDb to IMDb...`);
                const { imdbId } = await completeIds(null, mediaDetails.tmdbId, type);
                if (imdbId) {
                    mediaDetails.imdbId = imdbId;
                    console.log(`🔄 [Background] Enriched IMDb ID: ${imdbId} from TMDb: ${mediaDetails.tmdbId}`);
                } else {
                    console.warn(`⚠️ [Background] IMDb conversion returned no data`);
                }
            } catch (error) {
                console.error(`❌ [Background] Error in IMDb conversion:`, error);
            }
        }
        
        console.log(`🔄 [Background] After ID conversion: imdbId=${mediaDetails.imdbId}, tmdbId=${mediaDetails.tmdbId}`);
        
        // �🇹 Get ITALIAN title and ORIGINAL title from TMDB (critical for Italian content!)
        // Use provided titles if available to avoid redundant API calls
        // Note: italianTitle and originalTitle are function parameters, use them directly
        let finalItalianTitle = italianTitle || null;
        let finalOriginalTitle = originalTitle || null;
        
        if (finalItalianTitle) {
            console.log(`🔄 [Background] Using provided Italian title: "${finalItalianTitle}"`);
        }
        if (finalOriginalTitle) {
            console.log(`🔄 [Background] Using provided Original title: "${finalOriginalTitle}"`);
        }
        
        // Only fetch from TMDB if we don't have the titles yet
        if ((!finalItalianTitle || !finalOriginalTitle) && mediaDetails.tmdbId) {
            console.log(`🔄 [Background] Fetching missing titles from TMDB (Italian: ${!finalItalianTitle}, Original: ${!finalOriginalTitle})`);
            try {
                const tmdbType = type === 'series' ? 'tv' : 'movie';
                const tmdbKey = process.env.TMDB_KEY || process.env.TMDB_API_KEY || '5462f78469f3d80bf5201645294c16e4';
                console.log(`🔄 [Background] Using TMDb key: ${tmdbKey.substring(0, 10)}... Type: ${tmdbType}`);
                
                // 1. Get ITALIAN title (language=it-IT) if not provided
                if (!finalItalianTitle) {
                    const italianUrl = `https://api.themoviedb.org/3/${tmdbType}/${mediaDetails.tmdbId}?api_key=${tmdbKey}&language=it-IT`;
                    console.log(`🔄 [Background] Fetching Italian title from: ${italianUrl.replace(tmdbKey, 'HIDDEN')}`);
                    const italianResponse = await fetch(italianUrl, {
                        signal: AbortSignal.timeout(8000)
                    });
                    console.log(`🔄 [Background] Italian response status: ${italianResponse.status}`);
                    if (italianResponse.ok) {
                        const italianData = await italianResponse.json();
                        finalItalianTitle = italianData.title || italianData.name;
                        console.log(`🔄 [Background] Italian data received. Title field: ${italianData.title}, Name field: ${italianData.name}`);
                        if (finalItalianTitle && finalItalianTitle !== mediaDetails.title) {
                            console.log(`🇮🇹 [Background] Found Italian title: "${finalItalianTitle}"`);
                        } else {
                            console.log(`⚠️ [Background] Italian title same as English or null: "${finalItalianTitle}"`);
                        }
                    } else {
                        console.error(`❌ [Background] Italian title fetch failed: ${italianResponse.status} ${italianResponse.statusText}`);
                    }
                }
                
                // 2. Get ORIGINAL title (no language param = original language) if not provided
                if (!finalOriginalTitle) {
                    const originalUrl = `https://api.themoviedb.org/3/${tmdbType}/${mediaDetails.tmdbId}?api_key=${tmdbKey}`;
                    const originalResponse = await fetch(originalUrl, {
                        signal: AbortSignal.timeout(8000)
                    });
                    if (originalResponse.ok) {
                        const originalData = await originalResponse.json();
                        finalOriginalTitle = originalData.original_title || originalData.original_name;
                        if (finalOriginalTitle && finalOriginalTitle !== mediaDetails.title && finalOriginalTitle !== finalItalianTitle) {
                            console.log(`🌍 [Background] Found original title: "${finalOriginalTitle}"`);
                        }
                    }
                }
            } catch (error) {
                console.warn(`⚠️ [Background] Could not fetch titles:`, error.message);
                console.error(`❌ [Background] Title fetch error details:`, error);
            }
        } else {
            console.warn(`⚠️ [Background] No TMDb ID available, cannot fetch Italian title`);
        }
        
        console.log(`🔄 [Background] Title fetching complete. Italian: "${finalItalianTitle}", Original: "${finalOriginalTitle}"`);
        
        // 🎯 SIMPLIFIED SEARCH: Solo titoli base (senza stagioni/episodi specifici)
        // Questo permette di trovare TUTTI i torrent e aggiungerli al DB
        const searchQueries = [];
        
        // 🇮🇹 PRIORITY 1: Italian title (MOST IMPORTANT for CorsaroNero!)
        if (finalItalianTitle && finalItalianTitle !== mediaDetails.title) {
            searchQueries.push(finalItalianTitle);
        }
        
        // 🇬🇧 PRIORITY 2: English title
        searchQueries.push(mediaDetails.title);
        
        // 🌍 PRIORITY 3: Original title (if different from both)
        if (finalOriginalTitle && finalOriginalTitle !== mediaDetails.title && finalOriginalTitle !== finalItalianTitle) {
            searchQueries.push(finalOriginalTitle);
        }
        
        console.log(`🔄 [Background] Simple search queries (all content):`, searchQueries);
        
        // Search CorsaroNero (IT focus)
        const corsaroResults = [];
        for (const query of searchQueries) {
            try {
                console.log(`🔄 [Background] Searching CorsaroNero for: "${query}"`);
                const results = await fetchCorsaroNeroData(query.trim(), type);
                corsaroResults.push(...results);
                console.log(`🔄 [Background] CorsaroNero: ${results.length} results for "${query}"`);
            } catch (error) {
                console.warn(`⚠️ [Background] CorsaroNero search failed for "${query}":`, error.message);
            }
        }
        
        console.log(`🔄 [Background] Total CorsaroNero results: ${corsaroResults.length}`);
        
        if (corsaroResults.length === 0) {
            console.log(`🔄 [Background] No new results from CorsaroNero`);
            return;
        }
        
        // 🔄 Prepare DB inserts with UPSERT logic (update IDs if missing)
        console.log(`🔄 [Background] Preparing ${corsaroResults.length} torrents for DB upsert...`);
        const torrentsToInsert = [];
        for (const result of corsaroResults) {
            if (!result.infoHash || result.infoHash.length < 32) {
                console.log(`⚠️ [Background] Skipping torrent with invalid hash (${result.infoHash?.length || 0} chars): ${result.title}`);
                continue;
            }
            
            // Extract IMDB ID from title if available (pattern: tt1234567)
            const imdbMatch = result.title.match(/tt\d{7,8}/i);
            const imdbId = imdbMatch ? imdbMatch[0] : (mediaDetails.imdbId || null);
            
            const torrentData = {
                info_hash: result.infoHash.toLowerCase(),
                provider: 'CorsaroNero',
                title: result.title,
                size: result.mainFileSize || result.sizeInBytes || 0,
                type: type,
                upload_date: new Date().toISOString(),
                seeders: result.seeders || 0,
                imdb_id: imdbId,
                tmdb_id: mediaDetails.tmdbId || null,
                cached_rd: null,
                last_cached_check: null,
                file_index: null
            };
            torrentsToInsert.push(torrentData);
            console.log(`📦 [Background] Prepared: ${result.title.substring(0, 50)}... (hash=${result.infoHash.substring(0,8)} imdb=${imdbId} size=${torrentData.size})`);
        }
        
        console.log(`🔄 [Background] Prepared ${torrentsToInsert.length}/${corsaroResults.length} valid torrents`);
        
        if (torrentsToInsert.length === 0) {
            console.log(`🔄 [Background] No valid torrents to insert (all had invalid hashes)`);
            return;
        }
        
        // 🔄 Use UPSERT logic to update existing torrents with missing IDs
        console.log(`🔄 [Background] Inserting/updating torrents with UPSERT (ON CONFLICT UPDATE)...`);
        
        // Insert into DB (batch insert)
        try {
            console.log(`💾 [Background] Calling batchInsertTorrents with ${torrentsToInsert.length} torrents...`);
            const insertedCount = await dbHelper.batchInsertTorrents(torrentsToInsert);
            console.log(`✅ [Background] batchInsertTorrents returned: ${insertedCount}`);
            console.log(`✅ [Background] Successfully inserted/updated ${insertedCount}/${torrentsToInsert.length} torrents in DB`);
            
            if (insertedCount === 0 && torrentsToInsert.length > 0) {
                console.log(`⚠️ [Background] All ${torrentsToInsert.length} torrents were already in DB (duplicates skipped)`);
            }
        } catch (error) {
            console.warn(`⚠️ [Background] Failed to insert torrents:`, error.message);
            console.error(`❌ [Background] Full error:`, error);
        }
        
    } catch (error) {
        console.error(`❌ [Background] Enrichment failed:`, error);
    }
}

// ✅ SOLUZIONE KITSU 1: Get MyAnimeList ID from Kitsu ID
async function getMALfromKitsu(kitsuId) {
    try {
        console.log(`🔄 [Kitsu→MAL] Fetching MAL ID for Kitsu ${kitsuId}...`);
        
        const response = await fetch(
            `https://kitsu.io/api/edge/anime/${kitsuId}/mappings`,
            { 
                headers: { 'Accept': 'application/vnd.api+json' },
                timeout: 5000 
            }
        );
        
        if (!response.ok) {
            console.warn(`⚠️ [Kitsu→MAL] Kitsu mappings API error: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        // Find MyAnimeList mapping
        const malMapping = data.data?.find(mapping => 
            mapping.attributes?.externalSite === 'myanimelist/anime'
        );
        
        if (!malMapping || !malMapping.attributes?.externalId) {
            console.log(`⚠️ [Kitsu→MAL] No MAL mapping found for Kitsu ${kitsuId}`);
            return null;
        }
        
        const malId = malMapping.attributes.externalId;
        console.log(`✅ [Kitsu→MAL] Kitsu ${kitsuId} → MAL ${malId}`);
        return malId;
        
    } catch (error) {
        console.error(`❌ [Kitsu→MAL] Error:`, error.message);
        return null;
    }
}

// ✅ SOLUZIONE KITSU 2: Get TMDb/IMDb IDs from MyAnimeList ID
async function getTMDbFromMAL(malId) {
    try {
        console.log(`🔄 [MAL→TMDb] Fetching TMDb/IMDb for MAL ${malId}...`);
        
        const response = await fetch(
            `https://arm.haglund.dev/api/v2/ids?source=myanimelist&id=${malId}`,
            { timeout: 5000 }
        );
        
        if (!response.ok) {
            console.warn(`⚠️ [MAL→TMDb] Haglund API error: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        
        console.log(`🔍 [MAL→TMDb] API Response:`, JSON.stringify(data).substring(0, 500));
        
        if (!data || typeof data !== 'object') {
            console.log(`⚠️ [MAL→TMDb] No TMDb mapping found for MAL ${malId}`);
            return null;
        }
        
        // API returns single object (not array)
        const tmdbId = data.themoviedb || null;
        const imdbId = data.imdb || null;
        
        if (tmdbId || imdbId) {
            console.log(`✅ [MAL→TMDb] MAL ${malId} → TMDb ${tmdbId}, IMDb ${imdbId}`);
            return { tmdbId, imdbId };
        }
        
        console.log(`⚠️ [MAL→TMDb] MAL ${malId} has no TMDb/IMDb IDs`);
        return null;
        
    } catch (error) {
        console.error(`❌ [MAL→TMDb] Error:`, error.message);
        return null;
    }
}

async function getKitsuDetails(kitsuId) {
    try {
        console.log(`🔄 [Kitsu] Fetching details for Kitsu ID: ${kitsuId}`);
        
        const response = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}`);
        if (!response.ok) throw new Error(`Kitsu API error: ${response.status}`);
        const data = await response.json();
        const anime = data.data;
        const attributes = anime.attributes;
        
        // Collect all potential titles to maximize search success
        const titles = new Set();
        if (attributes.canonicalTitle) titles.add(attributes.canonicalTitle);
        if (attributes.titles.en) titles.add(attributes.titles.en);
        if (attributes.titles.en_jp) titles.add(attributes.titles.en_jp);
        if (attributes.abbreviatedTitles) {
            attributes.abbreviatedTitles.forEach(t => titles.add(t));
        }

        const year = attributes.startDate ? new Date(attributes.startDate).getFullYear() : null;

        const mediaDetails = {
            title: attributes.canonicalTitle || attributes.titles.en || 'Unknown', // ✅ Aggiungi title singolo
            titles: Array.from(titles), // Return an array of possible titles
            year: year,
            type: 'series',
            kitsuId: kitsuId,
            imdbId: null,
            tmdbId: null
        };
        
        // ✅ SOLUZIONE KITSU 3: Try to populate IMDb/TMDb IDs via MAL bridge
        try {
            const malId = await getMALfromKitsu(kitsuId);
            
            if (malId) {
                const ids = await getTMDbFromMAL(malId);
                
                if (ids) {
                    mediaDetails.imdbId = ids.imdbId;
                    mediaDetails.tmdbId = ids.tmdbId;
                    console.log(`✅ [Kitsu] Populated IDs: IMDb ${ids.imdbId}, TMDb ${ids.tmdbId}`);
                } else {
                    console.log(`⚠️ [Kitsu] MAL ${malId} has no TMDb/IMDb mapping, will use FTS fallback`);
                }
            } else {
                console.log(`⚠️ [Kitsu] No MAL mapping found, will use FTS fallback`);
            }
        } catch (bridgeError) {
            console.warn(`⚠️ [Kitsu] MAL bridge failed, will use FTS fallback:`, bridgeError.message);
        }
        
        return mediaDetails;
        
    } catch (error) {
        console.error('❌ [Kitsu] Fetch error:', error);
        return null;
    }
}

// ✅ Enhanced caching with better cleanup
const cache = new Map();
const CACHE_TTL = 1800000; // 30 minutes
const MAX_CACHE_ENTRIES = 1000;

function cleanupCache() {
    const now = Date.now();
    const entries = Array.from(cache.entries());
    
    // Remove expired entries
    const validEntries = entries.filter(([key, { timestamp }]) => 
        now - timestamp <= CACHE_TTL
    );
    
    // If still too many entries, remove oldest
    if (validEntries.length > MAX_CACHE_ENTRIES) {
        validEntries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        validEntries.splice(MAX_CACHE_ENTRIES);
    }
    
    // Rebuild cache
    cache.clear();
    validEntries.forEach(([key, value]) => cache.set(key, value));
    
    console.log(`🧹 Cache cleanup: kept ${cache.size} entries`);
}

let lastCleanup = 0;
function maybeCleanupCache() {
    const now = Date.now();
    if (now - lastCleanup > 300000) { // Every 5 minutes
        cleanupCache();
        lastCleanup = now;
    }
}

// ✅ Enhanced main fetch function
async function fetchUIndexData(searchQuery, type = 'movie', italianTitle = null) {
    console.log(`🔄 Fetching UIndex results for: "${searchQuery}" (type: ${type})`);

    // Check cache first
    const cacheKey = `uindex:${searchQuery}:${type}`;
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log(`⚡ Using cached results for UIndex: "${searchQuery}"`);
            return cached.data;
        } else {
            cache.delete(cacheKey);
        }
    }

    try {
        // Use multi-strategy search for better results
        const rawResults = await searchUIndexMultiStrategy(searchQuery, type);
        
        if (!rawResults.length) {
            console.log('⚠️ No results found from any search strategy for UIndex');
            return [];
        }

        // Process and sort results
        const processedResults = processAndSortResults(rawResults, italianTitle);
        
        // Convert to expected format
        const formattedResults = processedResults.map(result => {
            let finalCategory = result.category || 'Unknown';
            const lowerCategory = finalCategory.toLowerCase();
            if (lowerCategory.startsWith('movie')) {
                finalCategory = 'Movies';
            } else if (lowerCategory.startsWith('tv') || lowerCategory.startsWith('telefilm') || lowerCategory.startsWith('serie')) {
                finalCategory = 'TV';
            } else if (lowerCategory.startsWith('anime')) {
                finalCategory = 'Anime';
            }
            return {
                magnetLink: result.magnetLink,
                websiteTitle: result.title,
                title: result.title,
                filename: result.title,
                quality: result.quality,
                size: result.size,
                source: result.source,
                seeders: result.seeders,
                leechers: result.leechers,
                infoHash: result.infoHash,
                mainFileSize: result.sizeInBytes,
                pubDate: new Date().toISOString(),
                categories: [finalCategory]
            };
        });

        // Cache results
        cache.set(cacheKey, {
            data: formattedResults,
            timestamp: Date.now()
        });

        console.log(`🎉 Successfully processed ${formattedResults.length} results for UIndex "${searchQuery}"`);
        return formattedResults;

    } catch (error) {
        console.error('❌ Error in fetchUIndexData:', error);
        return [];
    }
}

// ✅ IMPROVED Matching functions - Supporta SEASON PACKS come Torrentio
function isExactEpisodeMatch(torrentTitle, showTitleOrTitles, seasonNum, episodeNum, isAnime = false) {
    if (!torrentTitle || !showTitleOrTitles) return false;
    
    // DEBUG: Log rejected single episodes
    if (torrentTitle.includes('155da22a') || torrentTitle.includes('3d700a66') || 
        (torrentTitle.toLowerCase().includes('scissione') && torrentTitle.toLowerCase().includes('s01e01') && torrentTitle.toLowerCase().includes('2160p'))) {
        console.log(`🔍 [Match Debug] Checking: "${torrentTitle.substring(0,80)}" for S${seasonNum}E${episodeNum}`);
    }
    
    // ✅ STEP 1: Light cleaning (keep dots and dashes for episode ranges!)
    const lightCleanedTitle = torrentTitle
        .replace(/<[^>]*>/g, '')
        .replace(/[\[\]]/g, '')
        .replace(/\(.*?\)/g, '')
        .trim();
    
    // ✅ STEP 2: Heavy cleaning for title matching only
    const normalizedTorrentTitle = lightCleanedTitle.toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // Remove all punctuation including dots
        .replace(/\s+/g, ' ')
        .trim();
    
    const titlesToCheck = Array.isArray(showTitleOrTitles) ? showTitleOrTitles : [showTitleOrTitles];
    
    const isDebugTarget = torrentTitle.toLowerCase().includes('scissione') && 
                          torrentTitle.toLowerCase().includes('s01e01') && 
                          torrentTitle.toLowerCase().includes('2160p');

    // ✅ STEP 3: Check if title matches (PHASE 1 - Normal match)
    const checkTitleMatch = (titlesList) => {
        return titlesList.some(showTitle => {
            const normalizedShowTitle = showTitle.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            const showWords = normalizedShowTitle.split(' ')
                .filter(word => word.length > 2)
                .filter(word => !['the', 'and', 'or', 'in', 'on', 'at', 'to'].includes(word));
            
            if (showWords.length === 0) return false;

            const matchingWords = showWords.filter(word => 
                normalizedTorrentTitle.includes(word)
            );
            
            const percentageMatch = matchingWords.length / showWords.length;
            
            if (isDebugTarget) {
                console.log(`    🔍 Title match: showTitle="${showTitle}", showWords=[${showWords.join(',')}], matchingWords=[${matchingWords.join(',')}], percentage=${percentageMatch}`);
            }
            
            return percentageMatch >= 0.6;
        });
    };
    
    let titleIsAMatch = checkTitleMatch(titlesToCheck);
    
    // ✅ STEP 3.5: If no match, try PHASE 2 - Split on "-" as last resort
    if (!titleIsAMatch) {
        const fallbackTitles = titlesToCheck
            .filter(title => title.includes('-'))
            .map(title => title.split('-')[0].trim());
        
        if (fallbackTitles.length > 0) {
            if (isDebugTarget) {
                console.log(`    🔄 Trying fallback with titles before "-": ${JSON.stringify(fallbackTitles)}`);
            }
            titleIsAMatch = checkTitleMatch(fallbackTitles);
        }
    }
    
    if (!titleIsAMatch) {
        if (isDebugTarget) {
            console.log(`    ❌ Title matching FAILED for "${torrentTitle.substring(0,60)}"`);
        }
        return false;
    }
    
    if (isDebugTarget) {
        console.log(`    ✅ Title matching PASSED, checking episode patterns...`);
    }
    
    if (isAnime) {
        // ✅ ANIME: Match episode ranges on LIGHT cleaned title (preserves dots/dashes)
        // For anime, look for absolute episode numbers (no season)
        // Patterns to match:
        // 1. Single episode: " 163 ", " - 163", "E163", etc.
        // 2. Episode range: "E144-195", "144-195", etc.
        
        const episodeStr = String(episodeNum).padStart(2, '0');
        const episodeNumStr = String(episodeNum);
        
        // Check for single episode match on light cleaned title
        const animePatterns = [
            new RegExp(`\\b${episodeNum}\\b(?!p|i|\\.|bit)`, 'i'), // e.g., " 163 " but not "1080p" or "7.1" or "10bit"
            new RegExp(`\\be${episodeStr}\\b(?!\\d)`, 'i'),  // E20 not E201
            new RegExp(`\\be${episodeNumStr}\\b(?!\\d)`, 'i'), // E163 not E1630
            new RegExp(`\\s-\\s${episodeStr}\\b`, 'i'),
            new RegExp(`\\s-\\s${episodeNumStr}\\b`, 'i')
        ];
        
        const singleMatch = animePatterns.some(pattern => pattern.test(lightCleanedTitle));
        if (singleMatch) {
            console.log(`✅ [ANIME] Episode match for "${torrentTitle.substring(0, 80)}" Ep.${episodeNum}`);
            return true;
        }
        
        // ✅ Check for episode range (e.g., "E144-195", "144-195", "E01-30", "E1001-1050")
        // CRITICAL: Use light cleaned title that PRESERVES dots/dashes!
        // Common patterns: SxxE##-## or just ##-##
        const rangePatterns = [
            /(?:s\d{1,2})?[eE](\d{1,4})\s*[-–—]\s*(?:[eE])?(\d{1,4})/g,  // S01E144-195 or E1001-E1050
            /(?<!\d)(\d{1,4})\s*[-–—]\s*(\d{1,4})(?!\d)/g                // 144-195 (not part of year like 1999-2011)
        ];
        
        console.log(`🔍 [ANIME RANGE DEBUG] Light cleaned title: "${lightCleanedTitle}"`);
        
        for (const pattern of rangePatterns) {
            const matches = lightCleanedTitle.matchAll(pattern);
            for (const match of matches) {
                const startEp = parseInt(match[1]);
                const endEp = parseInt(match[2]);
                
                console.log(`🔍 [ANIME RANGE] Found range: ${startEp}-${endEp}, checking if contains ${episodeNum}`);
                
                // ✅ STRICT VALIDATION: 
                // 1. Start must be less than end
                // 2. Range must be reasonable (≤300 episodes per pack)
                // 3. Reject year ranges (e.g., 1999-2011)
                const rangeSize = endEp - startEp;
                const isValidRange = (
                    startEp > 0 && 
                    endEp > startEp && 
                    endEp <= 9999 &&
                    rangeSize <= 300 &&  // Max 300 episodes per pack
                    startEp < 1900        // Not a year!
                );
                
                if (!isValidRange) {
                    console.log(`❌ [ANIME RANGE] Invalid range ${startEp}-${endEp}: size=${rangeSize}, startEp=${startEp}`);
                    continue;
                }
                
                if (episodeNum >= startEp && episodeNum <= endEp) {
                    console.log(`✅ [ANIME RANGE] "${torrentTitle.substring(0, 80)}" contains Ep.${startEp}-${endEp} (includes ${episodeNum})`);
                    return true;
                } else {
                    console.log(`❌ [ANIME RANGE] Episode ${episodeNum} NOT in range ${startEp}-${endEp}`);
                }
            }
        }
        
        console.log(`❌ [ANIME] Episode match for "${torrentTitle.substring(0, 80)}" Ep.${episodeNum}`);
        return false;
    }
    
    const seasonStr = String(seasonNum).padStart(2, '0');
    const episodeStr = String(episodeNum).padStart(2, '0');
    
    // ✅ NUOVA LOGICA: Cerca prima l'episodio specifico
    const exactEpisodePatterns = [
        new RegExp(`s${seasonStr}e${episodeStr}`, 'i'),
        new RegExp(`${seasonNum}x${episodeStr}`, 'i'),
        new RegExp(`[^0-9]${seasonNum}${episodeStr}[^0-9]`, 'i'),
        new RegExp(`season\s*${seasonNum}\s*episode\s*${episodeNum}`, 'i'),
        new RegExp(`s${seasonStr}\.?e${episodeStr}`, 'i'),
        new RegExp(`${seasonStr}${episodeStr}`, 'i')
    ];
    
    if (isDebugTarget) {
        console.log(`    🔍 Testing episode patterns on normalized: "${normalizedTorrentTitle.substring(0,80)}"`);
        exactEpisodePatterns.forEach((pattern, i) => {
            const match = pattern.test(normalizedTorrentTitle);
            console.log(`      Pattern ${i+1}: ${pattern} → ${match ? '✅ MATCH' : '❌ no match'}`);
        });
    }
    
    const exactMatch = exactEpisodePatterns.some(pattern => pattern.test(normalizedTorrentTitle));
    if (exactMatch) {
        console.log(`✅ [EXACT] Episode match for "${torrentTitle}" S${seasonStr}E${episodeStr}`);
        return true;
    }
    
    // ✅ EPISODE RANGE: Check if episode is in a range (e.g., "S06E01-25" contains E06)
    // Pattern: S06E01-25, S06E01-E25, 6x01-25, etc.
    const episodeRangePattern = new RegExp(
        `s${seasonStr}e(\\d{1,2})\\s*[-–—]\\s*e?(\\d{1,2})`, 'i'
    );
    const rangeMatch = normalizedTorrentTitle.match(episodeRangePattern);
    if (rangeMatch) {
        const startEp = parseInt(rangeMatch[1]);
        const endEp = parseInt(rangeMatch[2]);
        if (episodeNum >= startEp && episodeNum <= endEp) {
            console.log(`✅ [EPISODE RANGE] Match for "${torrentTitle}" S${seasonStr}E${startEp}-${endEp} contains E${episodeStr}`);
            return true;
        }
    }
    
    // ✅ NUOVA LOGICA: Se non trova l'episodio esatto, cerca SEASON PACK
    // Es: "Simpson Stagione 27", "Simpson S27", "Simpson Season 27 Complete"
    const seasonPackPatterns = [
        // Italiano
        new RegExp(`stagione\\s*${seasonNum}(?!\\d)`, 'i'),
        new RegExp(`stagione\\s*${seasonStr}(?!\\d)`, 'i'),
        // Inglese
        new RegExp(`season\\s*${seasonNum}(?!\\d)`, 'i'),
        new RegExp(`season\\s*${seasonStr}(?!\\d)`, 'i'),
        // Formato compatto S01 o S1
        // Dopo normalizzazione: "S01.1080p" → "s011080p", "S01.ITA" → "s01ita"
        // Pattern intelligente: riconosce resolution (480-2160p), anni (1900-2099), parole (ita/eng/complete)
        new RegExp(
            `s${seasonStr}(?:` +
            `(?:480|720|1080|1440|2160)p?|` +  // Resolution comuni
            `(?:19|20)\\d{2}|` +                // Anno
            `[a-z]{2,}|` +                      // Parola (ita, eng, multi, complete, etc.)
            `\\s|$` +                           // Spazio o fine stringa
            `)`,
            'i'
        ),
        // S1 (single digit) - stesso approccio ma evita S1E
        new RegExp(
            `s0*${seasonNum}(?:` +
            `(?:480|720|1080|1440|2160)p?|` +
            `(?:19|20)\\d{2}|` +
            `[a-z]{2,}|` +
            `\\s|$` +
            `)(?!e)`,  // NON seguito da 'e' (evita S1E)
            'i'
        ),
        // Complete pack con keywords
        new RegExp(`s${seasonStr}.*(?:completa|complete|full|series)`, 'i'),
        new RegExp(`(?:completa|complete|full|series).*s${seasonStr}`, 'i')
    ];
    
    const seasonPackMatch = seasonPackPatterns.some(pattern => pattern.test(normalizedTorrentTitle));
    if (seasonPackMatch) {
        console.log(`✅ [SEASON PACK] Match for "${torrentTitle}" contains Season ${seasonNum}`);
        return true;
    }
    
    // ✅ MULTI-SEASON RANGE: Check if season is within a range (e.g., "S01-S10" includes S08)
    // Patterns: S01-S10, Season 1-10, Stagione 1-10, S1-S10, etc.
    const multiSeasonRangePattern = /(?:s|season|stagione)\s*(\d{1,2})\s*[-–—]\s*(?:s|season|stagione)?\s*(\d{1,2})/i;
    const seasonRangeMatch = normalizedTorrentTitle.match(multiSeasonRangePattern);
    if (seasonRangeMatch) {
        const startSeason = parseInt(seasonRangeMatch[1]);
        const endSeason = parseInt(seasonRangeMatch[2]);
        console.log(`🔍 [MULTI-SEASON CHECK] "${torrentTitle}" has range S${startSeason}-S${endSeason}, checking if Season ${seasonNum} is included...`);
        if (seasonNum >= startSeason && seasonNum <= endSeason) {
            console.log(`✅ [MULTI-SEASON RANGE] Match for "${torrentTitle}" S${startSeason}-S${endSeason} contains Season ${seasonNum}`);
            return true;
        } else {
            console.log(`❌ [MULTI-SEASON RANGE] Season ${seasonNum} is NOT in range S${startSeason}-S${endSeason}`);
        }
    }
    
    console.log(`❌ No match for "${torrentTitle}" S${seasonStr}E${episodeStr}`);
    return false;
}

function isExactMovieMatch(torrentTitle, movieTitle, year) {
    if (!torrentTitle || !movieTitle) return false;
    
    torrentTitle = torrentTitle.replace(/<[^>]*>/g, '')
        .replace(/[\[.*?\]]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    const normalizedTorrentTitle = torrentTitle.toLowerCase();
    const normalizedMovieTitle = movieTitle.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    let hasEnoughMovieWords;

    const movieWords = normalizedMovieTitle.split(' ').filter(word => word.length > 2 && !['the', 'and', 'or', 'in', 'on', 'at', 'to'].includes(word));

    if (movieWords.length === 0) {
        // Handle very short titles like "F1" or "IT" where word-based matching would fail
        const titleRegex = new RegExp(`\\b${normalizedMovieTitle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        hasEnoughMovieWords = titleRegex.test(normalizedTorrentTitle);
    } else {
        const matchingWords = movieWords.filter(word => 
            normalizedTorrentTitle.includes(word)
        );
        const percentageMatch = matchingWords.length / movieWords.length;
        hasEnoughMovieWords = percentageMatch >= 0.7;
        if (!hasEnoughMovieWords) {
            console.log(`❌ Movie match failed for "${torrentTitle}" - ${percentageMatch.toFixed(2)} match`);
        }
    }
    
    if (!hasEnoughMovieWords) {
        return false;
    }
    
    const yearMatch = torrentTitle.match(/(?:19|20)\d{2}/);
    
    const yearMatches = !yearMatch || 
           yearMatch[0] === year.toString() || 
           Math.abs(parseInt(yearMatch[0]) - parseInt(year)) <= 1;
           
    console.log(`${yearMatches ? '✅' : '❌'} Year match for "${torrentTitle}" (${year})`);
    return yearMatches;
}

/**
 * Match the best file in a pack torrent for a specific movie
 * @param {Array} files - Array of files from torrent info
 * @param {Object} movieDetails - Movie details (title, originalTitle, year)
 * @returns {number|null} - Best matching file index or null
 */
function matchPackFile(files, movieDetails) {
    if (!files || files.length === 0) return null;
    
    const { title, originalTitle, year } = movieDetails;
    console.log(`🎯 [Pack] Matching file for: ${title} (${originalTitle}) [${year}]`);
    
    // Normalize titles for comparison
    const normalizeTitle = (str) => str.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    const italianWords = normalizeTitle(title).split(' ');
    const englishWords = originalTitle ? normalizeTitle(originalTitle).split(' ') : [];
    
    let bestScore = 0;
    let bestFileIndex = null;
    
    files.forEach((file, index) => {
        const filename = normalizeTitle(file.path || '');
        let score = 0;
        
        // Skip non-video files
        const videoExtensions = /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v)$/i;
        if (!videoExtensions.test(file.path)) {
            return;
        }
        
        // Level 1: Title match (70% of score)
        // Italian title: 40%
        const italianMatches = italianWords.filter(word => 
            word.length > 2 && filename.includes(word)
        ).length;
        const italianScore = (italianMatches / italianWords.length) * 0.4;
        score += italianScore;
        
        // English title: 30%
        if (englishWords.length > 0) {
            const englishMatches = englishWords.filter(word => 
                word.length > 2 && filename.includes(word)
            ).length;
            const englishScore = (englishMatches / englishWords.length) * 0.3;
            score += englishScore;
        }
        
        // Level 2: Sequence number match (20% of score)
        // Extract part numbers: "Part II", "Parte 2", "II", "2", etc.
        const partMatch = filename.match(/\b(?:part|parte|chapter|capitolo)?\s*([ivxIVX]+|[0-9]+)\b/);
        if (partMatch) {
            const partNum = partMatch[1];
            // Check if this number/numeral appears in the title
            if (title.includes(partNum) || (originalTitle && originalTitle.includes(partNum))) {
                score += 0.2;
            }
        }
        
        // Level 3: Year match (10% of score)
        const yearMatch = filename.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
        if (yearMatch && yearMatch[1] === year.toString()) {
            score += 0.1;
        }
        
        console.log(`📁 [Pack] File ${index}: ${file.path.substring(0, 50)}... - Score: ${(score * 100).toFixed(1)}%`);
        
        if (score > bestScore) {
            bestScore = score;
            bestFileIndex = index;
        }
    });
    
    if (bestFileIndex !== null) {
        console.log(`✅ [Pack] Best match: File ${bestFileIndex} (${files[bestFileIndex].path}) - Score: ${(bestScore * 100).toFixed(1)}%`);
    } else {
        console.log(`❌ [Pack] No suitable file found in pack`);
    }
    
    return bestFileIndex;
}

// ✅ Enhanced stream handler with better error handling and logging
async function handleStream(type, id, config, workerOrigin) {
    maybeCleanupCache();
    
    // The ID from Stremio might be URL-encoded, especially on Android.
    const decodedId = decodeURIComponent(id);
    
    console.log(`\n🎯 Processing ${type} with ID: ${decodedId}`);
    
    const startTime = Date.now();
    
    try {
        // ✅ TMDB API Key from config or environment variable
        const tmdbKey = config.tmdb_key || process.env.TMDB_API_KEY;
        
        if (!tmdbKey) {
            console.error('❌ TMDB API key not configured');
            return { streams: [] };
        }
        
        // ✅ Use debrid services factory (supports RD, Torbox, and AllDebrid)
        const debridServices = createDebridServices(config);
        const useRealDebrid = debridServices.useRealDebrid;
        const useTorbox = debridServices.useTorbox;
        const useAllDebrid = debridServices.useAllDebrid;
        const rdService = debridServices.realdebrid;
        const torboxService = debridServices.torbox;
        const adService = debridServices.alldebrid;

        let imdbId = null;
        let kitsuId = null;
        let season = null;
        let episode = null;
        let mediaDetails = null;

        if (decodedId.startsWith('kitsu:')) {
            const parts = decodedId.split(':');
            kitsuId = parts[1];
            const absoluteEpisode = parts[2]; // For Kitsu, this is absolute episode number (optional for movies)
            
            // ✅ If no episode number, it's a MOVIE (e.g., kitsu:45513 = One Piece Film Red)
            if (!absoluteEpisode && type === 'movie') {
                console.log(`🎬 Looking up Kitsu movie details for: ${kitsuId}`);
                mediaDetails = await getKitsuDetails(kitsuId);
                
                if (mediaDetails) {
                    mediaDetails.isAnime = true;  // Mark as anime for special handling
                    // For movies, we don't need episode info
                }
            } else if (!absoluteEpisode && type === 'series') {
                // Series MUST have episode number
                console.log('❌ Invalid Kitsu format: episode number required for series');
                return { streams: [] };
            } else {
                // Series with episode number
                // For Kitsu anime, we don't have season mapping - store as absolute episode
                // We'll search for generic packs without season filtering
                season = null;  // No season for Kitsu
                episode = absoluteEpisode;
                
                console.log(`🌸 Looking up Kitsu details for: ${kitsuId}, absolute episode: ${absoluteEpisode}`);
                mediaDetails = await getKitsuDetails(kitsuId);
                
                // Add absolute episode info to mediaDetails
                if (mediaDetails) {
                    mediaDetails.absoluteEpisode = parseInt(absoluteEpisode);
                    mediaDetails.isAnime = true;  // Mark as anime for special handling
                }
            }
        } else {
            // ✅ SOLUZIONE 2: Detect if ID is TMDb (pure number) or IMDb (starts with 'tt')
            imdbId = decodedId;
            if (type === 'series') {
                const parts = decodedId.split(':');
                imdbId = parts[0];
                season = parts[1];
                episode = parts[2];
                
                if (!season || !episode) {
                    console.log('❌ Invalid series format');
                    return { streams: [] };
                }
            }
            
            // Check if ID is TMDb (pure number) or IMDb (starts with 'tt')
            if (imdbId.startsWith('tt')) {
                // IMDb ID format
                const cleanImdbId = extractImdbId(imdbId);
                if (!cleanImdbId) {
                    console.log('❌ Invalid IMDB ID format');
                    return { streams: [] };
                }
                
                console.log(`🔍 Looking up TMDB details for IMDb: ${cleanImdbId}`);
                mediaDetails = await getTMDBDetailsByImdb(cleanImdbId, tmdbKey);
            } else if (/^\d+$/.test(imdbId)) {
                // TMDb ID format (pure number)
                const tmdbId = parseInt(imdbId);
                console.log(`🔍 Looking up details for TMDb: ${tmdbId}`);
                mediaDetails = await getTMDBDetailsByTmdb(tmdbId, type, tmdbKey);
            } else {
                console.log('❌ Invalid ID format (not IMDb or TMDb)');
                return { streams: [] };
            }
        }

        if (!mediaDetails) {
            console.log('❌ Could not find media details');
            return { streams: [] };
        }
        
        // --- NUOVA MODIFICA: Ottieni il titolo in italiano ---
        let italianTitle = null;
        let originalTitle = null;
        if (mediaDetails.tmdbId && !kitsuId) { // Solo per film/serie da TMDB
            try {
                // Convert 'series' to 'tv' for TMDB API
                const tmdbType = mediaDetails.type === 'series' ? 'tv' : 'movie';
                console.log(`🔍 [Italian Title] Using TMDB type: ${tmdbType} for mediaDetails.type: ${mediaDetails.type}`);
                
                // 1. Prima chiamata: ottieni dettagli in italiano (language=it-IT)
                const italianDetails = await getTMDBDetails(mediaDetails.tmdbId, tmdbType, tmdbKey, 'external_ids', 'it-IT');
                console.log(`🔍 [Italian Title] TMDB response with language=it-IT received`);
                
                if (italianDetails) {
                    const italianTitleFromResponse = italianDetails.title || italianDetails.name;
                    console.log(`🔍 [Italian Title] Found title from it-IT response: "${italianTitleFromResponse}"`);
                    
                    // Usa il titolo italiano se è diverso da quello inglese
                    if (italianTitleFromResponse && italianTitleFromResponse.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                        italianTitle = italianTitleFromResponse;
                        console.log(`🇮🇹 Found Italian title from language=it-IT: "${italianTitle}"`);
                    } else if (italianTitleFromResponse) {
                        console.log(`⚠️ [Italian Title] Title from it-IT "${italianTitleFromResponse}" is same as English, will try translations`);
                    }
                    
                    // Salva anche l'original_title/original_name
                    if (italianDetails.original_title || italianDetails.original_name) {
                        const foundOriginalTitle = italianDetails.original_title || italianDetails.original_name;
                        if (foundOriginalTitle && foundOriginalTitle.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                            originalTitle = foundOriginalTitle;
                            console.log(`� Found original title: "${originalTitle}"`);
                        }
                    }
                }
                
                // 2. Fallback: se non abbiamo trovato il titolo italiano, prova con translations
                if (!italianTitle) {
                    console.log(`🔍 [Italian Title] Trying translations as fallback...`);
                    const detailsWithTranslations = await getTMDBDetails(mediaDetails.tmdbId, tmdbType, tmdbKey, 'translations', 'en-US');
                    
                    if (detailsWithTranslations?.translations?.translations) {
                        console.log(`🔍 [Italian Title] Found ${detailsWithTranslations.translations.translations.length} translations`);
                        const italianTranslation = detailsWithTranslations.translations.translations.find(t => t.iso_639_1 === 'it');
                        
                        if (italianTranslation) {
                            console.log(`🔍 [Italian Title] Italian translation found:`, JSON.stringify(italianTranslation.data));
                            const foundTitle = italianTranslation.data.title || italianTranslation.data.name;
                            if (foundTitle && foundTitle.toLowerCase() !== mediaDetails.title.toLowerCase()) {
                                italianTitle = foundTitle;
                                console.log(`🇮� Found Italian title from translations: "${italianTitle}"`);
                            }
                        } else {
                            console.log(`⚠️ [Italian Title] No Italian (it) translation found in translations array`);
                        }
                    } else {
                        console.log(`⚠️ [Italian Title] No translations data available`);
                    }
                }
                
                if (!italianTitle) {
                    console.log(`⚠️ [Italian Title] Could not find Italian title for "${mediaDetails.title}"`);
                }
            } catch (e) {
                console.warn("⚠️ Could not fetch Italian title from TMDB:", e.message);
            }
        }
        // --- FINE MODIFICA ---
        
        // ✅ BUILD TITLES ARRAY: Include all possible titles for matching
        if (!Array.isArray(mediaDetails.titles)) {
            const allTitles = new Set();
            // Always include the main English title
            if (mediaDetails.title) {
                allTitles.add(mediaDetails.title);
                // If title contains ":", also add the part before it (e.g., "Suburra: Blood on Rome" → "Suburra")
                if (mediaDetails.title.includes(':')) {
                    allTitles.add(mediaDetails.title.split(':')[0].trim());
                }
            }
            // Add Italian title if found
            if (italianTitle && italianTitle !== mediaDetails.title) {
                allTitles.add(italianTitle);
                // If Italian title contains ":", also add the part before it
                if (italianTitle.includes(':')) {
                    allTitles.add(italianTitle.split(':')[0].trim());
                }
            }
            // Add original title if different
            if (originalTitle && originalTitle !== mediaDetails.title && originalTitle !== italianTitle) {
                allTitles.add(originalTitle);
                // If original title contains ":", also add the part before it
                if (originalTitle.includes(':')) {
                    allTitles.add(originalTitle.split(':')[0].trim());
                }
            }
            
            mediaDetails.titles = Array.from(allTitles);
            console.log(`📝 Built titles array: ${JSON.stringify(mediaDetails.titles)}`);
        }

        const displayTitle = Array.isArray(mediaDetails.titles) ? mediaDetails.titles[0] : mediaDetails.title;
        console.log(`✅ Found: ${displayTitle} (${mediaDetails.year})`);

        // ✅ STEP 1: INITIALIZE DATABASE (always try, fallback to hardcoded credentials)
        let dbEnabled = false;
        try {
            // Call initDatabase WITHOUT parameters to use hardcoded fallback credentials
            dbHelper.initDatabase();
            dbEnabled = true;
            console.log('💾 [DB] Database connection initialized');
        } catch (error) {
            console.error('❌ [DB] Failed to initialize database:', error.message);
            console.error('❌ [DB] Will continue without database');
        }

        // ✅ STEP 2: SEARCH DATABASE FIRST (if enabled)
        let dbResults = [];
        if (dbEnabled && mediaDetails.imdbId) {
            if (type === 'series') {
                // For anime (Kitsu), we don't have season mapping - skip episode search, get all packs
                if (mediaDetails.isAnime || season === null) {
                    console.log(`🎌 [Anime] Skipping episode search for anime, fetching all packs`);
                    dbResults = await dbHelper.searchByImdbId(mediaDetails.imdbId, type);
                } else {
                    // Search for specific episode (normal series)
                    dbResults = await dbHelper.searchEpisodeFiles(
                        mediaDetails.imdbId, 
                        parseInt(season), 
                        parseInt(episode)
                    );
                    
                    // 🔥 ALSO search for season packs and complete packs (they don't have file_index)
                    const packResults = await dbHelper.searchByImdbId(mediaDetails.imdbId, type);
                    console.log(`💾 [DB] Found ${packResults.length} additional torrents (packs/complete series)`);
                    
                    // Merge: episode files + packs
                    dbResults = [...dbResults, ...packResults];
                }
            } else {
                // Search for movie - both singles AND packs
                // 📦 PRIORITY 1: Search pack_files first (with file_index)
                const packResults = await dbHelper.searchPacksByImdbId(mediaDetails.imdbId);
                if (packResults && packResults.length > 0) {
                    console.log(`💾 [DB] Found ${packResults.length} pack(s) containing film ${mediaDetails.imdbId}`);
                }
                
                // PRIORITY 2: Search regular torrents (single movies or packs via all_imdb_ids)
                const regularResults = await dbHelper.searchByImdbId(mediaDetails.imdbId, type);
                
                // Merge: packs first (with file_index), then regular
                dbResults = [...(packResults || []), ...regularResults];
            }

            // If found in DB, check if IDs are complete and convert if needed
            if (dbResults.length > 0) {
                console.log(`💾 [DB] Found ${dbResults.length} results in database!`);
                
                // ✅ SOLUZIONE 3: Check if we need to complete IDs and update DB
                const firstResult = dbResults[0];
                if ((firstResult.imdb_id && !firstResult.tmdb_id) || 
                    (!firstResult.imdb_id && firstResult.tmdb_id)) {
                    console.log(`💾 [DB] Completing missing IDs for database results...`);
                    const completed = await completeIds(
                        firstResult.imdb_id, 
                        firstResult.tmdb_id, 
                        type === 'series' ? 'series' : 'movie'
                    );
                    
                    // Update mediaDetails with completed IDs
                    if (completed.tmdbId && !mediaDetails.tmdbId) {
                        mediaDetails.tmdbId = completed.tmdbId;
                        console.log(`💾 [DB] Populated mediaDetails.tmdbId: ${completed.tmdbId}`);
                    }
                    if (completed.imdbId && !mediaDetails.imdbId) {
                        mediaDetails.imdbId = completed.imdbId;
                        console.log(`💾 [DB] Populated mediaDetails.imdbId: ${completed.imdbId}`);
                    }
                    
                    // ✅ SOLUZIONE 3: Update DB with completed IDs (auto-repair)
                    if (completed.imdbId || completed.tmdbId) {
                        console.log(`💾 [DB] Auto-repairing ${dbResults.length} torrents with completed IDs...`);
                        // Extract all info_hash from dbResults
                        const infoHashes = dbResults.map(r => r.info_hash).filter(Boolean);
                        if (infoHashes.length > 0) {
                            const updatedCount = await dbHelper.updateTorrentsWithIds(
                                infoHashes,           // ALL hashes from DB results
                                completed.imdbId,     // Populate missing imdb_id
                                completed.tmdbId      // Populate missing tmdb_id
                            );
                            if (updatedCount > 0) {
                                console.log(`✅ [DB] Auto-repaired ${updatedCount} torrent(s) with completed IDs`);
                            }
                        }
                    }
                }
            }
        }

        // ✅ STEP 3: If no results in DB and we have TMDb ID, try searching by TMDb
        if (dbEnabled && dbResults.length === 0 && mediaDetails.tmdbId) {
            console.log(`💾 [DB] No results by IMDb, trying TMDb ID: ${mediaDetails.tmdbId}`);
            
            // 🔥 FIX: For series with episode info, get imdbId from TMDb first and use searchEpisodeFiles
            if (type === 'series' && season && episode) {
                try {
                    // Get IMDb ID from TMDb torrents table
                    const tmdbTorrents = await dbHelper.searchByTmdbId(mediaDetails.tmdbId, type);
                    if (tmdbTorrents.length > 0 && tmdbTorrents[0].imdb_id) {
                        const imdbId = tmdbTorrents[0].imdb_id;
                        console.log(`💾 [DB] Found imdbId ${imdbId} from TMDb, searching episode files...`);
                        
                        // Search episode files
                        const episodeFiles = await dbHelper.searchEpisodeFiles(imdbId, parseInt(season), parseInt(episode));
                        console.log(`💾 [DB] Found ${episodeFiles.length} files for S${season}E${episode}`);
                        
                        // 🔥 ALSO get all torrents (for packs)
                        console.log(`💾 [DB] Also fetching all torrents for packs...`);
                        dbResults = [...episodeFiles, ...tmdbTorrents];
                        console.log(`💾 [DB] Total: ${dbResults.length} results (files + packs)`);
                    } else {
                        // Fallback: use TMDb search (won't have file_title)
                        dbResults = tmdbTorrents;
                    }
                } catch (err) {
                    console.error(`❌ [DB] Error searching episode files by TMDb:`, err.message);
                    dbResults = await dbHelper.searchByTmdbId(mediaDetails.tmdbId, type);
                }
            } else {
                // For movies or when no episode info, use regular TMDb search
                dbResults = await dbHelper.searchByTmdbId(mediaDetails.tmdbId, type);
            }
            
            if (dbResults.length > 0) {
                console.log(`💾 [DB] Found ${dbResults.length} results by TMDb ID!`);
                
                // ✅ SOLUZIONE 3: Auto-repair IDs when found via TMDb but missing IMDb
                const firstResult = dbResults[0];
                if (firstResult.tmdb_id && !firstResult.imdb_id && mediaDetails.imdbId) {
                    console.log(`💾 [DB] Auto-repairing ${dbResults.length} torrents found via TMDb (missing IMDb)...`);
                    // Extract all info_hash from dbResults
                    const infoHashes = dbResults.map(r => r.info_hash).filter(Boolean);
                    if (infoHashes.length > 0) {
                        const updatedCount = await dbHelper.updateTorrentsWithIds(
                            infoHashes,           // ALL hashes from DB results
                            mediaDetails.imdbId,  // Populate missing imdb_id
                            mediaDetails.tmdbId   // Keep tmdb_id
                        );
                        if (updatedCount > 0) {
                            console.log(`✅ [DB] Auto-repaired ${updatedCount} torrent(s) with IMDb ID`);
                        }
                    }
                }
            }
        }

        // ✅ STEP 4: If still no results, try FULL-TEXT SEARCH (FTS) as fallback
        if (dbEnabled && dbResults.length === 0 && mediaDetails && mediaDetails.title) {
            console.log(`💾 [DB] No results by ID. Trying Full-Text Search (FTS)...`);
            
            // Helper to extract short title (before ":" or "-")
            const extractShortTitle = (title) => {
                if (!title) return null;
                
                // Try splitting by ":" first
                if (title.includes(':')) {
                    const short = title.split(':')[0].trim();
                    if (short.length > 0) return short;
                }
                
                // Try splitting by " - " (with spaces)
                if (title.includes(' - ')) {
                    const short = title.split(' - ')[0].trim();
                    if (short.length > 0) return short;
                }
                
                return null;
            };
            
            // Import cleanTitleForSearch for title cleaning
            // Note: We need to replicate the logic here since it's not exported from daily-scraper
            const cleanTitleForFTS = (title) => {
                if (!title) return '';
                let cleaned = title;
                cleaned = cleaned.replace(/\.(mkv|mp4|avi|mov)$/gi, '');
                cleaned = cleaned.replace(/^\s*[\[\(]\d{4}[\]\)]\s*/g, '');
                const beforeSeriesPattern = cleaned.match(/^(.+?)(?:\s*[\s._-]*(?:Stagion[ei]|Season[s]?|EP\.?|S\d{1,2}|\d{1,2}x\d{1,2}|19\d{2}|20\d{2}|\d{4}))/i);
                if (beforeSeriesPattern) {
                    cleaned = beforeSeriesPattern[1];
                    cleaned = cleaned.replace(/[\s._-]+$/g, '');
                } else {
                    cleaned = cleaned.replace(/[\s._-]*Stagion[ei].*/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*Season[s]?.*/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*S\d{2}(E\d{2})?(-S?\d{2})?(E\d{2})?/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*\d{1,2}x\d{1,2}/gi, '');
                    cleaned = cleaned.replace(/[\s._-]*EP\.?\s*\d{1,2}/gi, '');
                }
                cleaned = cleaned.replace(/\[.*?\]/g, '');
                cleaned = cleaned.replace(/\(.*?\)/g, '');
                cleaned = cleaned.replace(/[\(\[]\s*$/g, '');
                cleaned = cleaned.replace(/\b(COMPLETA?|Completa?|FULL|Complete|Miniserie|MiniSerieTV|SERIE|Serie|SerieTV|TV|EXTENDED|Extended)\b/gi, '');
                cleaned = cleaned.replace(/\bDirector'?s?\s*Cut\b/gi, '');
                cleaned = cleaned.replace(/\bUncut\b/gi, '');
                cleaned = cleaned.replace(/\bStagion[ei].*/gi, '');
                cleaned = cleaned.replace(/\bSeason[s]?.*/gi, '');
                cleaned = cleaned.replace(/\d{2,3}-\d{2,3}\/\d{2,3}/g, '');
                cleaned = cleaned.replace(/\?\?/g, '');
                cleaned = cleaned.replace(/[._-]+/g, ' ');
                cleaned = cleaned.replace(/\b(SD|HD|720p|1080p|2160p|4K|UHD|BluRay|WEB DL|WEBRip|HDTV|DVDRip|BRRip|WEBDL)\b/gi, '');
                cleaned = cleaned.replace(/\b(ITA|ENG|SPA|FRA|GER|JAP|KOR|MULTI|Multisub|SubS?|DUB|NFRip)\b/gi, '');
                cleaned = cleaned.replace(/\b(DV|HDR|HDR10|HDR10Plus|H264|H265|H 264|H 265|x264|x265|HEVC|AVC|10bit|AAC|AC3|Mp3|DD5? 1|DTS|Atmos|DDP\d+ ?\d*)\b/gi, '');
                cleaned = cleaned.replace(/\b(AMZN|NF|DSNP|HULU|HBO|ATVP|WEBMUX)\b/gi, '');
                cleaned = cleaned.replace(/\b(MeM|GP|TheBlackKing|TheWhiteQueen|MIRCrew|FGT|RARBG|YTS|YIFY|ION10|PSA|FLUX|NAHOM|V3SP4|Notorious)\b/gi, '');
                cleaned = cleaned.replace(/\bby[A-Za-z0-9]+\b/gi, '');
                cleaned = cleaned.replace(/\s+/g, ' ').trim();
                cleaned = cleaned.replace(/\s+(L'|Il |La |Gli |I |Le |Lo |Un |Una |Uno )[a-zàèéìòù']+(\s+[a-zàèéìòù']+)*$/g, '');
                cleaned = cleaned.replace(/[\s-]+$/g, '').trim();
                return cleaned;
            };
            
            const cleanedTitle = cleanTitleForFTS(mediaDetails.title);
            console.log(`💾 [DB FTS] Cleaned title: "${cleanedTitle}"`);
            
            try {
                // ✅ PHASE 1: Try with full title first
                dbResults = await dbHelper.searchByTitleFTS(
                    cleanedTitle,
                    type,
                    mediaDetails.year
                );
                
                // ✅ PHASE 2: If no results and title has ":" or "-", try short title
                if (dbResults.length === 0) {
                    const shortTitle = extractShortTitle(mediaDetails.title);
                    if (shortTitle && shortTitle !== mediaDetails.title) {
                        const cleanedShortTitle = cleanTitleForFTS(shortTitle);
                        console.log(`💾 [DB FTS] No results with full title. Trying short title: "${cleanedShortTitle}"`);
                        
                        dbResults = await dbHelper.searchByTitleFTS(
                            cleanedShortTitle,
                            type,
                            mediaDetails.year
                        );
                        
                        if (dbResults.length > 0) {
                            console.log(`💾 [DB FTS Fallback] Found ${dbResults.length} results with short title!`);
                        }
                    }
                }
                
                if (dbResults.length > 0) {
                    console.log(`💾 [DB FTS] Found ${dbResults.length} results via Full-Text Search!`);
                    
                    // If we found results with FTS but they have NULL IDs, try to populate them
                    const firstResult = dbResults[0];
                    if (firstResult.imdb_id && !mediaDetails.imdbId) {
                        mediaDetails.imdbId = firstResult.imdb_id;
                        console.log(`💾 [DB FTS] Populated imdbId from FTS result: ${firstResult.imdb_id}`);
                    }
                    if (firstResult.tmdb_id && !mediaDetails.tmdbId) {
                        mediaDetails.tmdbId = firstResult.tmdb_id;
                        console.log(`💾 [DB FTS] Populated tmdbId from FTS result: ${firstResult.tmdb_id}`);
                    }
                } else {
                    console.log(`💾 [DB FTS] No results found. Will search online sources...`);
                }
            } catch (error) {
                console.error(`❌ [DB FTS] Search failed:`, error.message);
                // Continue to live search
            }
            
            // Try to complete missing IDs for better matching later
            if ((mediaDetails.imdbId && !mediaDetails.tmdbId) || 
                (!mediaDetails.imdbId && mediaDetails.tmdbId)) {
                console.log(`🔄 Completing missing media IDs for future use...`);
                const completed = await completeIds(
                    mediaDetails.imdbId, 
                    mediaDetails.tmdbId, 
                    type === 'series' ? 'series' : 'movie'
                );
                
                if (completed.imdbId) mediaDetails.imdbId = completed.imdbId;
                if (completed.tmdbId) mediaDetails.tmdbId = completed.tmdbId;
            }
        }

        // ✅ 3-TIER STRATEGY: Check if we should skip live search
        let skipLiveSearch = dbResults.length > 0;
        
        // 📺 For series: check if at least one result matches the requested season
        // If all results are from different seasons, we should still do live search
        if (skipLiveSearch && type === 'series' && season) {
            const hasMatchingSeason = dbResults.some(result => {
                const title = result.title || result.torrent_title || '';
                const seasonPattern = new RegExp(`[Ss](0?${season})[Ee\\s]|[Ss]tagione?\\s*${season}|[Ss]eason\\s*${season}`, 'i');
                return seasonPattern.test(title);
            });
            
            if (!hasMatchingSeason) {
                console.log(`⚠️ [3-Tier] Found ${dbResults.length} results but none match Season ${season} - will do live search`);
                skipLiveSearch = false;
            }
        }
        
        if (skipLiveSearch) {
            console.log(`✅ [3-Tier] Found ${dbResults.length} results from DB/FTS (Tier 1/2)`);
            console.log(`⏭️  [3-Tier] Skipping live search (Tier 3) - will use cached results`);
        } else {
            console.log(`🔍 [3-Tier] No results from DB/FTS (Tier 1/2) - proceeding to live search (Tier 3)`);
        }

        // Build search queries (ALWAYS - needed for both live search AND enrichment)
        const searchQueries = [];
        let finalSearchQueries = []; // Declare here, outside the conditional blocks
        
        // Helper function to generate queries for a given title (SERIES ONLY)
        const addQueriesForTitle = (title, label = '') => {
            if (!title || type !== 'series' || kitsuId) return;
            
            const seasonStr = String(season).padStart(2, '0');
            const episodeStr = String(episode).padStart(2, '0');
            
            // Extract short version (before ":" if present)
            const shortTitle = title.includes(':') ? title.split(':')[0].trim() : title;
            
            // 0. SHORT TITLE ALONE FIRST (generic search - CRITICAL for enrichment!)
            searchQueries.push(shortTitle);
            
            // 1. BASE QUERIES (short version - higher priority)
            searchQueries.push(`${shortTitle} S${seasonStr}E${episodeStr}`);  // Episode specific
            searchQueries.push(`${shortTitle} S${seasonStr}`);                 // Season pack
            searchQueries.push(`${shortTitle} Stagione ${season}`);            // Italian word
            searchQueries.push(`${shortTitle} Season ${season}`);              // English word
            searchQueries.push(`${shortTitle} Complete`);                      // Complete pack
            searchQueries.push(`${shortTitle} S01`);                           // S01 packs
            
            // 2. COMPLETE QUERIES WITH CODES (full title with ":")
            if (title !== shortTitle) {
                searchQueries.push(`${title} S${seasonStr}E${episodeStr}`);
                searchQueries.push(`${title} S${seasonStr}`);
            }
            
            // 3. COMPLETE QUERIES WITH WORDS (full title with "Stagione/Season")
            if (title !== shortTitle) {
                searchQueries.push(`${title} Stagione ${season}`);
                searchQueries.push(`${title} Season ${season}`);
            }
            
            // 4. COMPLETE TITLE ONLY (for complete packs)
            if (title !== shortTitle) {
                searchQueries.push(title);
            }
            
            // 5. NORMALIZED QUERIES (without ":" but with spaces)
            if (title !== shortTitle && title.includes(':')) {
                const normalized = title.replace(/:/g, '');
                searchQueries.push(`${normalized} S${seasonStr}`);
                searchQueries.push(`${normalized} S${seasonStr}E${episodeStr}`);
            }
            
            if (label) console.log(`📝 Added queries for ${label}: "${title}"`);
        };
        
        // Always build queries (needed for enrichment even when skipping live search)
        console.log(`📝 [Queries] Building search queries for enrichment and live search...`);
        if (type === 'series') {
            if (kitsuId) { // Anime search strategy
                const uniqueQueries = new Set();
                const absEpisode = mediaDetails.absoluteEpisode || episode;
                console.log(`🎌 [Anime] Building queries for absolute episode ${absEpisode}, titles: ${mediaDetails.titles.length}`);
                
                // Use all available titles from Kitsu to build search queries
                for (const title of mediaDetails.titles) {
                    // 1. Title + absolute episode number (e.g., "Naruto 24", "One Piece 786")
                    uniqueQueries.add(`${title} ${absEpisode}`);
                    // 2. Just title (to find large packs and collections)
                    uniqueQueries.add(title);
                }
                searchQueries.push(...uniqueQueries);
            } else { // Regular series search strategy
                // Add queries for main English title
                addQueriesForTitle(mediaDetails.title, 'English title');
            }
        } else { // Movie
            searchQueries.push(`${mediaDetails.title} ${mediaDetails.year}`);
            searchQueries.push(mediaDetails.title); // Aggiunto per completezza
        }

        // --- NUOVA MODIFICA: Aggiungi titolo italiano e originale alle query di ricerca ---
        if (italianTitle && type === 'series' && !kitsuId) {
            console.log(`🇮🇹 Adding Italian title queries...`);
            addQueriesForTitle(italianTitle, 'Italian title');
        } else if (italianTitle && type === 'movie') {
            searchQueries.push(`${italianTitle} ${mediaDetails.year}`);
            searchQueries.push(italianTitle);
            // Also add short version if it has ":"
            if (italianTitle.includes(':')) {
                const shortItalian = italianTitle.split(':')[0].trim();
                searchQueries.push(`${shortItalian} ${mediaDetails.year}`);
                searchQueries.push(shortItalian);
            }
        }

        if (originalTitle && type === 'series' && !kitsuId) {
            console.log(`🌍 Adding original title queries...`);
            addQueriesForTitle(originalTitle, 'Original title');
        } else if (originalTitle && type === 'movie') {
            searchQueries.push(`${originalTitle} ${mediaDetails.year}`);
            searchQueries.push(originalTitle);
            // Also add short version if it has ":"
            if (originalTitle.includes(':')) {
                const shortOriginal = originalTitle.split(':')[0].trim();
                searchQueries.push(`${shortOriginal} ${mediaDetails.year}`);
                searchQueries.push(shortOriginal);
            }
        }
        
        // Rimuovi duplicati e logga
        finalSearchQueries = [...new Set(searchQueries)];
        console.log(`📚 Final search queries (${finalSearchQueries.length} total):`, finalSearchQueries);
        // --- FINE MODIFICA ---

        // --- NUOVA LOGICA DI AGGREGAZIONE E DEDUPLICAZIONE ---
        const allRawResults = [];
        
        const searchType = kitsuId ? 'anime' : type;
        const TOTAL_RESULTS_TARGET = 50; // Stop searching when we have enough results to avoid excessive subrequests.
        let totalQueries = 0;
        
        // Only perform live search if no DB/FTS results
        if (!skipLiveSearch) {
            console.log(`🔍 [3-Tier] Starting live search (Tier 3)...`);

        // ✅ Initialize Jackettio if ENV vars are set
        let jackettioInstance = null;
        if (config.jackett_url && config.jackett_api_key) {
            jackettioInstance = new Jackettio(
                config.jackett_url, 
                config.jackett_api_key,
                config.jackett_password // Optional password
            );
            console.log('🔍 [Jackettio] Instance initialized (ITALIAN ONLY mode)');
        }

        for (const query of finalSearchQueries) {
            console.log(`\n🔍 Searching all sources for: "${query}"`);

            // Stop searching if we have a good number of results to process.
            if (allRawResults.length >= TOTAL_RESULTS_TARGET * 4) { // *4 because we have 4 sources (including Jackettio)
                console.log(`🎯 Target of ~${TOTAL_RESULTS_TARGET} unique results likely reached. Stopping further searches.`);
                break;
            }

            // Build search promises based on user selection
            const searchPromises = [];
            
            // Check which sites are enabled (default to all if not specified)
            const useUIndex = config.use_uindex !== false; // Default true
            const useCorsaroNero = config.use_corsaronero !== false; // Default true
            const useKnaben = config.use_knaben !== false; // Default true
            
            if (useUIndex) {
                console.log('📊 UIndex enabled for search');
                searchPromises.push({
                    name: 'UIndex',
                    promise: fetchUIndexData(query, searchType, italianTitle)
                });
            } else {
                console.log('⏭️  UIndex disabled by user');
            }
            
            if (useCorsaroNero) {
                console.log('🏴‍☠️ CorsaroNero enabled for search');
                searchPromises.push({
                    name: 'CorsaroNero',
                    promise: fetchCorsaroNeroData(query, searchType)
                });
            } else {
                console.log('⏭️  CorsaroNero disabled by user');
            }
            
            if (useKnaben) {
                console.log('🦉 Knaben enabled for search');
                searchPromises.push({
                    name: 'Knaben',
                    promise: fetchKnabenData(query, searchType)
                });
            } else {
                console.log('⏭️  Knaben disabled by user');
            }

            // Add Jackettio if configured
            if (jackettioInstance) {
                console.log('🔍 Jackettio enabled for search');
                searchPromises.push({
                    name: 'Jackettio',
                    promise: fetchJackettioData(query, searchType, jackettioInstance)
                });
            }
            
            if (searchPromises.length === 0) {
                console.log('⚠️  No search sites enabled! Skipping search.');
                continue; // Skip to next query
            }

            const results = await Promise.allSettled(searchPromises.map(sp => sp.promise));

            // Process results dynamically
            results.forEach((result, index) => {
                const sourceName = searchPromises[index].name;
                if (result.status === 'fulfilled' && result.value) {
                    console.log(`✅ ${sourceName} returned ${result.value.length} results for query.`);
                    allRawResults.push(...result.value);
                } else if (result.status === 'rejected') {
                    console.error(`❌ ${sourceName} search failed:`, result.reason);
                }
            });

            totalQueries++;
            if (totalQueries < finalSearchQueries.length) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
        
        } // Close if (!skipLiveSearch) - end of live search block

        console.log(`🔎 Found a total of ${allRawResults.length} raw results from all sources. Performing smart deduplication...`);

        // ✅ ADD DATABASE RESULTS TO RAW RESULTS (if any)
        if (dbResults.length > 0) {
            console.log(`💾 [DB] Adding ${dbResults.length} database results to aggregation...`);
            
            // DEBUG: Log all unique hashes BEFORE filtering
            const uniqueHashes = [...new Set(dbResults.map(r => r.info_hash))];
            console.log(`💾 [DB] Before filter: ${uniqueHashes.length} unique torrents out of ${dbResults.length} total results`);
            uniqueHashes.forEach(hash => {
                const torrents = dbResults.filter(r => r.info_hash === hash);
                const firstTorrent = torrents[0];
                const title = firstTorrent.torrent_title || firstTorrent.title;
                console.log(`  - ${hash.substring(0,8)}: "${title.substring(0,60)}..." (appears ${torrents.length} times)`);
            });
            
            // ✅ FILTER DB RESULTS for series by season/episode (like scraping results)
            let filteredDbResults = dbResults;
            if (type === 'series' && season && episode) {
                const seasonNum = parseInt(season);
                const episodeNum = parseInt(episode);
                
                filteredDbResults = dbResults.filter(dbResult => {
                    // Handle different result formats: searchEpisodeFiles uses torrent_title, others use title
                    const torrentTitle = dbResult.torrent_title || dbResult.title;
                    const match = isExactEpisodeMatch(
                        torrentTitle, 
                        mediaDetails.titles || mediaDetails.title, 
                        seasonNum, 
                        episodeNum
                    );
                    
                    // DEBUG: Log rejected torrents
                    if (!match) {
                        console.log(`  ❌ REJECTED: ${dbResult.info_hash.substring(0,8)} - "${torrentTitle.substring(0,70)}"`);
                    }
                    
                    return match;
                });
                
                console.log(`💾 [DB] Filtered to ${filteredDbResults.length}/${dbResults.length} torrents matching S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')}`);
            }
            
            // ✅ DEDUPLICATE by info_hash (prefer entries with file_index for episode files)
            const deduplicatedMap = new Map();
            for (const dbResult of filteredDbResults) {
                const hash = dbResult.info_hash;
                if (!deduplicatedMap.has(hash)) {
                    deduplicatedMap.set(hash, dbResult);
                } else {
                    // ALWAYS prefer entry with file_index (from searchEpisodeFiles)
                    const existing = deduplicatedMap.get(hash);
                    const hasFileIndex = dbResult.file_index !== null && dbResult.file_index !== undefined;
                    const existingHasFileIndex = existing.file_index !== null && existing.file_index !== undefined;
                    
                    if (hasFileIndex && !existingHasFileIndex) {
                        // New has file_index, existing doesn't → replace
                        console.log(`💾 [DB Dedup] Replacing ${hash.substring(0,8)} (no fileIndex) with version that has fileIndex=${dbResult.file_index}`);
                        deduplicatedMap.set(hash, dbResult);
                    } else if (hasFileIndex && existingHasFileIndex) {
                        // Both have file_index → keep first one
                        console.log(`💾 [DB Dedup] Keeping first ${hash.substring(0,8)} fileIndex=${existing.file_index}, skipping duplicate with fileIndex=${dbResult.file_index}`);
                    }
                }
            }
            filteredDbResults = Array.from(deduplicatedMap.values());
            console.log(`💾 [DB] Deduplicated to ${filteredDbResults.length} unique torrents`);
            
            // Convert filtered DB results to scraper format
            for (const dbResult of filteredDbResults) {
                // Handle different result formats: searchEpisodeFiles uses torrent_title, others use title
                const torrentTitle = dbResult.torrent_title || dbResult.title;
                const torrentSize = dbResult.torrent_size || dbResult.size;
                // Only use file_title if it came from searchEpisodeFiles (has torrent_title field)
                // This ensures we only show the actual filename for the SPECIFIC episode
                const fileName = dbResult.torrent_title ? dbResult.file_title : undefined;
                
                // Build magnet link
                const magnetLink = `magnet:?xt=urn:btih:${dbResult.info_hash}&dn=${encodeURIComponent(torrentTitle)}`;
                
                // DEBUG: Log what we're adding
                console.log(`🔍 [DB ADD] Adding: hash=${dbResult.info_hash.substring(0, 8)}, title="${torrentTitle.substring(0, 50)}...", size=${formatBytes(torrentSize || 0)}, seeders=${dbResult.seeders || 0}`);
                
                // Add to raw results with high priority
                allRawResults.push({
                    title: torrentTitle,
                    infoHash: dbResult.info_hash.toUpperCase(),
                    magnetLink: magnetLink,
                    seeders: dbResult.seeders || 0,
                    leechers: 0,
                    size: torrentSize ? formatBytes(torrentSize) : 'Unknown',
                    sizeInBytes: torrentSize || 0,
                    quality: extractQuality(torrentTitle),
                    filename: fileName || torrentTitle,
                    source: `💾 ${dbResult.provider || 'Database'}`,
                    fileIndex: dbResult.file_index !== null && dbResult.file_index !== undefined ? dbResult.file_index : undefined, // For series episodes and pack movies
                    file_title: fileName || undefined // Real filename from DB (only for specific episode)
                });
                
                // DEBUG: Log file info from DB
                if (dbResult.file_index !== null && dbResult.file_index !== undefined) {
                    console.log(`   📁 Has file: fileIndex=${dbResult.file_index}, file_title=${fileName}`);
                }
            }
            
            console.log(`💾 [DB] Total raw results after DB merge: ${allRawResults.length}`);
        }

        // Smart Deduplication
        const bestResults = new Map();
        for (const result of allRawResults) {
            if (!result.infoHash) continue;
            const hash = result.infoHash;
            const newLangInfo = getLanguageInfo(result.title, italianTitle);

            if (!bestResults.has(hash)) {
                bestResults.set(hash, result);
                console.log(`✅ [Dedup] NEW hash: ${hash.substring(0, 8)}... -> ${result.title.substring(0, 60)}... (${result.size}, ${result.seeders} seeds)`);
            } else {
                const existing = bestResults.get(hash);
                console.log(`🔍 [Dedup] DUPLICATE hash: ${hash.substring(0, 8)}... comparing "${existing.title.substring(0, 50)}..." vs "${result.title.substring(0, 50)}..."`);
                console.log(`   Existing: size=${existing.size}, seeders=${existing.seeders}, fileIndex=${existing.fileIndex}`);
                console.log(`   New: size=${result.size}, seeders=${result.seeders}, fileIndex=${result.fileIndex}`);
                const existingLangInfo = getLanguageInfo(existing.title, italianTitle);

                let isNewBetter = false;
                // An Italian version is always better than a non-Italian one.
                if (newLangInfo.isItalian && !existingLangInfo.isItalian) {
                    isNewBetter = true;
                } else if (newLangInfo.isItalian === existingLangInfo.isItalian) {
                    // If language is the same, prefer Jackettio (private instance)
                    if (result.source === 'Jackettio' && existing.source !== 'Jackettio') {
                        isNewBetter = true;
                    } else if (existing.source === 'Jackettio' && result.source !== 'Jackettio') {
                        isNewBetter = false; // Keep Jackettio
                    } else if (result.source === 'CorsaroNero' && existing.source !== 'CorsaroNero' && existing.source !== 'Jackettio') {
                        isNewBetter = true;
                    } else if (result.source === existing.source || (result.source !== 'CorsaroNero' && existing.source !== 'CorsaroNero' && result.source !== 'Jackettio' && existing.source !== 'Jackettio')) {
                        // If source is also the same, or neither is the preferred one, prefer more seeders
                        if ((result.seeders || 0) > (existing.seeders || 0)) {
                            isNewBetter = true;
                        }
                    }
                }
                
                if (isNewBetter) {
                    console.log(`🔄 [Dedup] REPLACE hash ${hash.substring(0, 8)}...: "${existing.title}" -> "${result.title}" (better)`);
                    // Preserve file_title from existing if new doesn't have it
                    if (!result.file_title && existing.file_title) {
                        result.file_title = existing.file_title;
                        result.fileIndex = existing.fileIndex;
                        console.log(`🔄 [Dedup] Preserved file_title: ${existing.file_title}`);
                    }
                    bestResults.set(hash, result);
                } else {
                    console.log(`⏭️  [Dedup] SKIP hash ${hash.substring(0, 8)}...: "${result.title}" (keeping "${existing.title}")`);
                    // Preserve file_title from new if existing doesn't have it
                    if (!existing.file_title && result.file_title) {
                        existing.file_title = result.file_title;
                        existing.fileIndex = result.fileIndex;
                        bestResults.set(hash, existing); // Update map with modified object
                        console.log(`⏭️  [Dedup] Added file_title from skipped: ${result.file_title}`);
                    }
                }
            }
        }

        let results = Array.from(bestResults.values());
        console.log(`✨ After smart deduplication, we have ${results.length} unique, high-quality results.`);
        // --- FINE NUOVA LOGICA ---
        
        if (!results || results.length === 0) {
            console.log('❌ No results found from any source after all fallbacks');
            return { streams: [] };
        }
        
        console.log(`📡 Found ${results.length} total torrents from all sources after fallbacks`);
        
        // ✅ Apply exact matching filters
        let filteredResults = results;
        
        if (type === 'series') {
            const originalCount = filteredResults.length;
            console.log(`📺 [Episode Filtering] Starting with ${originalCount} results for S${season}E${episode}`);
            
            filteredResults = filteredResults.filter(result => {
                const match = isExactEpisodeMatch(
                    result.title || result.websiteTitle,
                    mediaDetails.titles || mediaDetails.title,
                    parseInt(season),
                    parseInt(episode),
                    !!kitsuId
                );
                
                if (!match) {
                    console.log(`❌ [Episode Filtering] REJECTED: "${result.title}"`);
                } else {
                    console.log(`✅ [Episode Filtering] ACCEPTED: "${result.title}"`);
                }
                
                return match;
            });
            
            console.log(`📺 Episode filtering: ${filteredResults.length} of ${originalCount} results match`);
            
            // ⚠️ FALLBACK: For NON-anime series, if exact matching fails, be more lenient
            // For anime, NEVER use fallback - if no episode matches, return nothing!
            if (filteredResults.length === 0 && originalCount > 0 && !kitsuId) {
                console.log('⚠️ Exact filtering removed all results, using broader match (NON-ANIME only)');
                filteredResults = results.slice(0, Math.min(10, results.length));
            } else if (filteredResults.length === 0 && kitsuId) {
                console.log(`❌ [ANIME] No packs found containing episode ${episode}. Returning empty results.`);
            }
        } else if (type === 'movie') {
            const originalCount = filteredResults.length;
            let movieDetails = null;
            if (mediaDetails.tmdbId) {
                movieDetails = await getTMDBDetails(mediaDetails.tmdbId, 'movie', tmdbKey);
            }
            filteredResults = filteredResults.filter(result => {
                const torrentTitle = result.title || result.websiteTitle;
                
                // 🎯 SKIP YEAR FILTERING FOR PACKS (they contain multiple movies with different years)
                // Packs are identified by having a fileIndex (from pack_files table)
                if (result.fileIndex !== null && result.fileIndex !== undefined) {
                    console.log(`🎬 [Pack] SKIP year filter for pack: ${torrentTitle.substring(0, 60)}... (fileIndex=${result.fileIndex})`);
                    return true; // Always keep packs, they're already filtered by IMDb ID in DB query
                }
                
                // Try matching with English title
                const mainTitleMatch = isExactMovieMatch(
                    torrentTitle,
                    mediaDetails.title,
                    mediaDetails.year
                );
                if (mainTitleMatch) return true;

                // Try matching with Italian title
                if (italianTitle && italianTitle !== mediaDetails.title) {
                    const italianMatch = isExactMovieMatch(
                        torrentTitle,
                        italianTitle,
                        mediaDetails.year
                    );
                    if (italianMatch) return true;
                }

                // Try matching with original title
                if (movieDetails && movieDetails.original_title && movieDetails.original_title !== mediaDetails.title) {
                    return isExactMovieMatch(
                        torrentTitle,
                        movieDetails.original_title,
                        mediaDetails.year
                    );
                }
                return false;
            });
            console.log(`🎬 Movie filtering: ${filteredResults.length} of ${originalCount} results match`);
            
            // If exact matching removed too many results, be more lenient
            if (filteredResults.length === 0 && originalCount > 0) {
                console.log('⚠️ Exact filtering removed all results, using broader match');
                filteredResults = results.slice(0, Math.min(15, results.length));
            }
        }
        
        // Limit results for performance
        const maxResults = 30; // Increased limit
        filteredResults = filteredResults.slice(0, maxResults);
        
        console.log(`🔄 Checking debrid services for ${filteredResults.length} results...`);
        const hashes = filteredResults.map(t => t.infoHash.toLowerCase()).filter(h => h && h.length >= 32);
        
        if (hashes.length === 0) {
            console.log('❌ No valid info hashes found');
            return { streams: [] };
        }

        // ✅ Check cache for enabled services in parallel
        let rdCacheResults = {};
        let rdUserTorrents = [];
        let torboxCacheResults = {};
        let torboxUserTorrents = [];
        let adCacheResults = {};

        const cacheChecks = [];
        
        if (useRealDebrid) {
            console.log('🔵 Checking Real-Debrid cache...');
            cacheChecks.push(
                (async () => {
                    // ⚠️ instantAvailability is DISABLED by RealDebrid (error_code 37)
                    // Strategy: Use DB cache (10-day TTL) + mark as cached on successful unrestrict
                    
                    // STEP 1: Check DB cache for known cached torrents (< 10 days)
                    let dbCachedResults = {};
                    if (dbEnabled) {
                        dbCachedResults = await dbHelper.getRdCachedAvailability(hashes);
                        console.log(`💾 [DB Cache] ${Object.keys(dbCachedResults).length}/${hashes.length} hashes found in cache (< 10 days)`);
                    }
                    
                    // STEP 2: Set DB cached results
                    rdCacheResults = dbCachedResults;
                    
                    // STEP 3: Get user torrents (personal cache - already added to RD account)
                    rdUserTorrents = await rdService.getTorrents().catch(e => {
                        console.error("⚠️ Failed to fetch RD user torrents.", e.message);
                        return [];
                    });
                    
                    // STEP 4: Save user's personal cache to DB (becomes global cache for all users)
                    if (dbEnabled && rdUserTorrents.length > 0) {
                        const userCacheToSave = rdUserTorrents
                            .filter(t => t.hash && t.status === 'downloaded' && hashes.includes(t.hash.toLowerCase()))
                            .map(t => ({ hash: t.hash.toLowerCase(), cached: true }));
                        
                        if (userCacheToSave.length > 0) {
                            await dbHelper.updateRdCacheStatus(userCacheToSave);
                            console.log(`💾 [GLOBAL CACHE] Saved ${userCacheToSave.length} RD personal torrents to DB (now available for all users)`);
                        }
                    }
                })()
            );
        }
        
        if (useTorbox) {
            console.log('📦 Checking Torbox cache...');
            cacheChecks.push(
                Promise.all([
                    torboxService.checkCache(hashes),
                    torboxService.getTorrents().catch(e => {
                        console.error("⚠️ Failed to fetch Torbox user torrents.", e.message);
                        return [];
                    })
                ]).then(([cache, torrents]) => {
                    torboxCacheResults = cache;
                    torboxUserTorrents = torrents;
                })
            );
        }
        
        if (useAllDebrid) {
            console.log('🅰️ Checking AllDebrid cache...');
            cacheChecks.push(
                adService.checkCache(hashes).then(cache => {
                    adCacheResults = cache;
                }).catch(e => {
                    console.error("⚠️ Failed to fetch AllDebrid cache.", e.message);
                })
            );
        }
        
        await Promise.all(cacheChecks);
        
        console.log(`✅ Cache check complete. RD: ${rdUserTorrents.length} torrents, Torbox: ${torboxUserTorrents.length} torrents, AllDebrid: ${Object.keys(adCacheResults).length} hashes`);
        
        // ✅ PACK FILE MATCHING: For movies with pack torrents, determine best file
        if (type === 'movie' && mediaDetails) {
            console.log(`\n🎯 [Pack] Checking for pack torrents in ${filteredResults.length} results...`);
            
            for (const result of filteredResults) {
                // Detect if this is a pack (has all_imdb_ids or matches pack pattern)
                const isPack = /\b(trilog|saga|collection|collezione|pack|completa|integrale|filmografia)\b/i.test(result.title) ||
                               /\b(19[2-9]\d|20[0-3]\d)-(19[2-9]\d|20[0-3]\d)\b/.test(result.title);
                
                if (isPack) {
                    console.log(`📦 [Pack] Detected pack: "${result.title}"`);
                    
                    // Try to get torrent info to access file list
                    // We'll do this lazily when user clicks, but we can mark it as a pack
                    result.isPack = true;
                    
                    // For now, we'll handle file selection in the stream endpoint
                    // The stream endpoint will need to:
                    // 1. Add magnet to RD/Torbox
                    // 2. Get torrent info (file list)
                    // 3. Call matchPackFile() to find best file
                    // 4. Select that specific file
                }
            }
        }
        
        // ✅ Build streams with enhanced error handling - supports multiple debrid services
        const streams = [];
        
        for (const result of filteredResults) {
            try {
                const qualityDisplay = result.quality ? result.quality.toUpperCase() : 'Unknown';
                const qualitySymbol = getQualitySymbol(qualityDisplay);
                const { icon: languageIcon } = getLanguageInfo(result.title, italianTitle);
                const packIcon = isSeasonPack(result.title) ? '📦 ' : ''; // Season pack indicator
                const encodedConfig = btoa(JSON.stringify(config));
                const infoHashLower = result.infoHash.toLowerCase();
                
                // ✅ REAL-DEBRID STREAM (if enabled)
                if (useRealDebrid) {
                    const rdCacheData = rdCacheResults[infoHashLower];
                    const rdUserTorrent = rdUserTorrents.find(t => t.hash?.toLowerCase() === infoHashLower);
                    
                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;
                    
                    // ✅ UNIFIED ENDPOINT: Always use /rd-stream/ with magnet link
                    // For series, add season/episode info for pattern matching in packs
                    // For movie packs, add fileIdx for specific file selection
                    if (type === 'series' && season && episode) {
                        streamUrl = `${workerOrigin}/rd-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}/${season}/${episode}`;
                    } else if (type === 'movie' && result.fileIndex !== undefined && result.fileIndex !== null) {
                        // Movie pack: add fileIdx to URL
                        streamUrl = `${workerOrigin}/rd-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}/pack/${result.fileIndex}`;
                    } else {
                        streamUrl = `${workerOrigin}/rd-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    }
                    
                    // ✅ CACHE PRIORITY: DB cache (global) > User torrents (personal) > None
                    // 1. Check DB cache (saved by any user, valid < 5 days)
                    // 2. Check user's personal torrents (already added to their RD account)
                    // 3. No cache available
                    if (rdCacheData?.cached) {
                        cacheType = 'global';
                        console.log(`🔵 ⚡ RD GLOBAL cache (DB): ${result.title}`);
                    } else if (rdUserTorrent && rdUserTorrent.status === 'downloaded') {
                        cacheType = 'personal';
                        console.log(`🔵 👤 Found in RD PERSONAL cache: ${result.title}`);
                    } else {
                        cacheType = 'none';
                    }
                    
                    const isCached = cacheType === 'global' || cacheType === 'personal';
                    const cachedIcon = isCached ? '⚡ ' : '📥🧲 ';
                    const errorIcon = streamError ? '⚠️ ' : '';
                    
                    const streamName = [
                        cachedIcon + errorIcon + '🔵 ',
                        `[${result.source}]`,
                        packIcon + languageIcon,  // ← Pack icon + Language icon
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');
                    
                    const debugInfo = streamError ? `\n⚠️ Stream error: ${streamError}` : '';
                    let cacheInfoText;
                    if (cacheType === 'global') {
                        const variantInfo = rdCacheData?.variantsCount > 1 
                            ? ` (${rdCacheData.variantsCount} varianti disponibili)` 
                            : '';
                        cacheInfoText = `🔗 Streaming da cache Globale Real-Debrid${variantInfo}`;
                    } else if (cacheType === 'personal') {
                        cacheInfoText = '🔗 Streaming da cache Personale Real-Debrid';
                    } else {
                        cacheInfoText = '📥🧲 Aggiungi a Real-Debrid (download necessario)';
                    }
                    
                    // 🔥 Show "Pack Name / Episode Title" for series (user-friendly)
                    let displayTitle = result.title;
                    if (type === 'series' && season && episode && mediaDetails) {
                        // Check if we have the real file_title from DB
                        if (result.file_title) {
                            // Use the actual filename from DB
                            displayTitle = `${result.title}\n📂 ${result.file_title}`;
                        } else {
                            // Fallback to constructed title
                            const seasonStr = String(season).padStart(2, '0');
                            const episodeStr = String(episode).padStart(2, '0');
                            const episodeTitle = `${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                            displayTitle = `${result.title}\n📂 ${episodeTitle}`;
                        }
                    }
                    
                    const streamTitle = [
                        `🎬 ${displayTitle}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        cacheInfoText,
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : '',
                        debugInfo
                    ].filter(Boolean).join('\n');
                    
                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-realdebrid-optimized',
                            notWebReady: false
                        },
                        _meta: { 
                            infoHash: result.infoHash, 
                            cached: isCached, 
                            cacheSource: cacheType, 
                            service: 'realdebrid',
                            originalSize: result.size, 
                            quality: result.quality, 
                            seeders: result.seeders, 
                            error: streamError 
                        }
                    });
                }
                
                // ✅ TORBOX STREAM (if enabled)
                if (useTorbox) {
                    const torboxCacheData = torboxCacheResults[infoHashLower];
                    const torboxUserTorrent = torboxUserTorrents.find(t => t.hash?.toLowerCase() === infoHashLower);
                    
                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;
                    
                    // ✅ UNIFIED ENDPOINT: Always use /torbox-stream/ with magnet link
                    // The endpoint will handle: global cache, personal cache, or add new torrent
                    streamUrl = `${workerOrigin}/torbox-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    
                    // ✅ EXACT TORRENTIO LOGIC: If Torbox says cached, show as cached
                    if (torboxCacheData?.cached) {
                        cacheType = 'global';
                        console.log(`📦 ⚡ Torbox GLOBAL cache available: ${result.title}`);
                    } else if (torboxUserTorrent && torboxUserTorrent.download_finished === true) {
                        cacheType = 'personal';
                        console.log(`📦 👤 Found in Torbox PERSONAL cache: ${result.title}`);
                    } else {
                        cacheType = 'none';
                    }
                    
                    const isCached = cacheType === 'global' || cacheType === 'personal';
                    const cachedIcon = isCached ? '⚡ ' : '📥🧲 ';
                    const errorIcon = streamError ? '⚠️ ' : '';
                    
                    const streamName = [
                        cachedIcon + errorIcon + '📦 ',
                        `[${result.source}]`,
                        packIcon + languageIcon,  // ← Pack icon + Language icon
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');
                    
                    let cacheInfoText;
                    if (cacheType === 'global') {
                        cacheInfoText = '🔗 Streaming da cache Globale Torbox';
                    } else if (cacheType === 'personal') {
                        cacheInfoText = '🔗 Streaming da cache Personale Torbox';
                    } else {
                        cacheInfoText = '📥🧲 Aggiungi a Torbox';
                    }
                    
                    // 🔥 Show "Pack Name / Episode Title" for series (user-friendly)
                    let displayTitle = result.title;
                    if (type === 'series' && season && episode && mediaDetails) {
                        // Check if we have the real file_title from DB
                        if (result.file_title) {
                            // Use the actual filename from DB
                            displayTitle = `${result.title}\n📂 ${result.file_title}`;
                        } else {
                            // Fallback to constructed title
                            const seasonStr = String(season).padStart(2, '0');
                            const episodeStr = String(episode).padStart(2, '0');
                            const episodeTitle = `${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                            displayTitle = `${result.title}\n📂 ${episodeTitle}`;
                        }
                    }
                    
                    const streamTitle = [
                        `🎬 ${displayTitle}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        cacheInfoText,
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : '',
                    ].filter(Boolean).join('\n');
                    
                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-torbox-optimized',
                            notWebReady: false
                        },
                        _meta: { 
                            infoHash: result.infoHash, 
                            cached: isCached, 
                            cacheSource: cacheType, 
                            service: 'torbox',
                            originalSize: result.size, 
                            quality: result.quality, 
                            seeders: result.seeders 
                        }
                    });
                }
                
                // ✅ ALLDEBRID STREAM (if enabled)
                if (useAllDebrid) {
                    const adCacheData = adCacheResults[infoHashLower];
                    
                    let streamUrl = '';
                    let cacheType = 'none';
                    let streamError = null;
                    
                    // ✅ UNIFIED ENDPOINT: Always use /ad-stream/ with magnet link
                    streamUrl = `${workerOrigin}/ad-stream/${encodedConfig}/${encodeURIComponent(result.magnetLink)}`;
                    
                    if (adCacheData?.cached) {
                        cacheType = 'global';
                        console.log(`🅰️ ⚡ AllDebrid GLOBAL cache available: ${result.title}`);
                    } else {
                        cacheType = 'none';
                    }
                    
                    const isCached = cacheType === 'global';
                    const cachedIcon = isCached ? '⚡ ' : '📥🧲 ';
                    const errorIcon = streamError ? '⚠️ ' : '';
                    
                    const streamName = [
                        cachedIcon + errorIcon + '🅰️ ',
                        `[${result.source}]`,
                        packIcon + languageIcon,  // ← Pack icon + Language icon
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');
                    
                    let cacheInfoText;
                    if (cacheType === 'global') {
                        cacheInfoText = '🔗 Streaming da cache Globale AllDebrid';
                    } else {
                        cacheInfoText = '📥🧲 Aggiungi a AllDebrid';
                    }
                    
                    // 🔥 Show "Pack Name / Episode Title" for series (user-friendly)
                    let displayTitle = result.title;
                    if (type === 'series' && season && episode && mediaDetails) {
                        // Check if we have the real file_title from DB
                        if (result.file_title) {
                            // Use the actual filename from DB
                            displayTitle = `${result.title}\n📂 ${result.file_title}`;
                        } else {
                            // Fallback to constructed title
                            const seasonStr = String(season).padStart(2, '0');
                            const episodeStr = String(episode).padStart(2, '0');
                            const episodeTitle = `${mediaDetails.title} S${seasonStr}E${episodeStr}`;
                            displayTitle = `${result.title}\n📂 ${episodeTitle}`;
                        }
                    }
                    
                    const streamTitle = [
                        `🎬 ${displayTitle}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        cacheInfoText,
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : '',
                    ].filter(Boolean).join('\n');
                    
                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        url: streamUrl,
                        behaviorHints: {
                            bingeGroup: 'uindex-alldebrid-optimized',
                            notWebReady: false
                        },
                        _meta: { 
                            infoHash: result.infoHash, 
                            cached: isCached, 
                            cacheSource: cacheType, 
                            service: 'alldebrid',
                            originalSize: result.size, 
                            quality: result.quality, 
                            seeders: result.seeders 
                        }
                    });
                }
                
                // ✅ P2P STREAM (if no debrid service enabled)
                if (!useRealDebrid && !useTorbox && !useAllDebrid) {
                    const streamName = [
                        '[P2P]',
                        `[${result.source}]`,
                        packIcon + languageIcon,  // ← Pack icon + Language icon
                        qualitySymbol,
                        qualityDisplay,
                        `👥 ${result.seeders || 0}/${result.leechers || 0}`,
                        result.size && result.size !== 'Unknown' ? `💾 ${result.size}` : null
                    ].filter(Boolean).join(' | ');

                    const streamTitle = [
                        `🎬 ${result.title}`,
                        `📡 ${result.source} | 💾 ${result.size} | 👥 ${result.seeders || 0} seeds`,
                        '🔗 Link Magnet diretto (P2P)',
                        result.categories?.[0] ? `📂 ${result.categories[0]}` : ''
                    ].filter(Boolean).join('\n');

                    streams.push({
                        name: streamName,
                        title: streamTitle,
                        infoHash: result.infoHash,
                        behaviorHints: {
                            bingeGroup: 'uindex-p2p',
                            notWebReady: true
                        },
                        _meta: { infoHash: result.infoHash, cached: false, quality: result.quality, seeders: result.seeders }
                    });
                }
                
            } catch (error) {
                console.error(`❌ Error processing result:`, error);
                
                // Return a basic stream even if processing failed
                streams.push({
                    name: `❌ ${result.title} (Error)`,
                    title: `Error processing: ${error.message}`,
                    url: result.magnetLink,
                    behaviorHints: {
                        bingeGroup: 'uindex-error',
                        notWebReady: true
                    }
                });
            }
        }
        
        // ✅ Enhanced sorting: source, italian, cached first, then by quality, then by seeders
        streams.sort((a, b) => {
            // Funzione per ottenere il punteggio di priorità di un risultato
            const getPriorityScore = (name) => {
                if (name.includes('❌')) return 0; // Errori in fondo
                if (name.includes('⚡')) { // Risultati in cache
                    if (name.includes('🇮🇹')) return 10; // Italiano
                    if (name.includes('🌈')) return 9;  // Multi
                    return 8; // Altro
                }
                // Risultati non in cache
                if (name.includes('🇮🇹')) return 7; // Italiano
                if (name.includes('🌈')) return 6;  // Multi
                return 5; // Altro
            };

            const scoreA = getPriorityScore(a.name);
            const scoreB = getPriorityScore(b.name);

            if (scoreA !== scoreB) {
                return scoreB - scoreA; // Ordine decrescente per punteggio
            }
            
            // Se la priorità è la stessa, ordina prima per qualità...
            const qualityOrder = { '🔥': 5, '⭐': 4, '✅': 3, '📺': 2, '🎬': 1 };
            const getQualityScore = (name) => {
                const parts = name.split('|');
                for (const part of parts) {
                    const trimmed = part.trim();
                    if (qualityOrder[trimmed]) return qualityOrder[trimmed];
                }
                return 0;
            };

            const qualityA = getQualityScore(a.name);
            const qualityB = getQualityScore(b.name);

            if (qualityA !== qualityB) {
                return qualityB - qualityA;
            }
            
            // ...e infine per numero di seeders
            const seedsA = parseInt(a.name.match(/👥 (\d+)/)?.[1]) || 0;
            const seedsB = parseInt(b.name.match(/👥 (\d+)/)?.[1]) || 0;
            return seedsB - seedsA;
        });
        const cachedCount = streams.filter(s => s.name.includes('⚡')).length;
        const totalTime = Date.now() - startTime;
        
        console.log(`🎉 Successfully processed ${streams.length} streams in ${totalTime}ms`);
        console.log(`⚡ ${cachedCount} cached streams available for instant playback`);
        
        // 🔥 ENRICHMENT: VPS webhook (must complete BEFORE returning response)
        console.log(`🔍 [Background Check] dbEnabled=${dbEnabled}, mediaDetails=${!!mediaDetails}, tmdbId=${mediaDetails?.tmdbId}, imdbId=${mediaDetails?.imdbId}, kitsuId=${mediaDetails?.kitsuId}`);
        
        if (dbEnabled && mediaDetails && (mediaDetails.tmdbId || mediaDetails.imdbId || mediaDetails.kitsuId)) {
            console.log(`🔍 [Enrichment] Preparing webhook for "${mediaDetails.title}"`);
            console.log(`🔍 [Enrichment Titles] Italian: "${italianTitle || 'N/A'}", Original: "${originalTitle || 'N/A'}", English: "${mediaDetails.title}"`);
            
            const enrichmentUrl = process.env.ENRICHMENT_SERVER_URL || 'http://localhost:3001/enrich';
            const enrichmentApiKey = process.env.ENRICHMENT_API_KEY || 'change-me-in-production';
            
            console.log(`🚀 [Webhook] Calling VPS enrichment: ${enrichmentUrl}`);
            
            try {
                const webhookResponse = await fetch(enrichmentUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': enrichmentApiKey
                    },
                    body: JSON.stringify({
                        imdbId: mediaDetails.imdbId,
                        tmdbId: mediaDetails.tmdbId,
                        italianTitle: italianTitle,
                        originalTitle: originalTitle || mediaDetails.title,
                        type: type,
                        year: mediaDetails.year,
                        searchQueries: finalSearchQueries || [] // ✅ Send pre-built queries
                    }),
                    signal: AbortSignal.timeout(5000)
                });
                
                if (webhookResponse.ok) {
                    console.log(`✅ [Webhook] Enrichment queued (${webhookResponse.status})`);
                } else {
                    console.warn(`⚠️ [Webhook] Failed: ${webhookResponse.status}`);
                }
            } catch (err) {
                console.warn(`⚠️ [Webhook] Unreachable:`, err.message);
            }
        } else {
            console.log(`⏭️  [Background] Enrichment skipped (dbEnabled=${dbEnabled}, hasMediaDetails=${!!mediaDetails}, hasIds=${!!(mediaDetails?.tmdbId || mediaDetails?.imdbId || mediaDetails?.kitsuId)})`);
        }
        
        return { 
            streams,
            _debug: {
                originalQuery: searchQueries[0],
                totalResults: results.length,
                filteredResults: filteredResults.length,
                finalStreams: streams.length,
                cachedStreams: cachedCount,
                processingTimeMs: totalTime,
                tmdbData: mediaDetails
            }
        };
        
    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ Error in handleStream after ${totalTime}ms:`, error);
        
        return { 
            streams: [],
            _debug: {
                error: error.message,
                processingTimeMs: totalTime,
                step: 'handleStream'
            }
        };
    }
}

// ✅ TMDB helper functions (keeping existing but adding better error handling)
async function getTMDBDetails(tmdbId, type = 'movie', tmdbApiKey, append = 'external_ids', language = 'it-IT') {
    try {
        const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${tmdbApiKey}&language=${language}&append_to_response=${append}`;
        console.log(`🔍 [TMDB] Fetching: ${url.replace(tmdbApiKey, 'HIDDEN')}`);
        const response = await fetch(url, {
            signal: AbortSignal.timeout(8000)
        });
        console.log(`🔍 [TMDB] Response status: ${response.status} ${response.statusText}`);
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] Error response: ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${response.status}`);
        }
        const data = await response.json();
        console.log(`✅ [TMDB] Success! Title/Name field: ${data.title || data.name}`);
        return data;
    } catch (error) {
        console.warn('⚠️ TMDB fetch warning (will use fallback):', error.message);
        return null;
    }
}

async function getTVShowDetails(tmdbId, seasonNum, episodeNum, tmdbApiKey) {
    try {
        const showResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=external_ids`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!showResponse.ok) {
            const errorText = await showResponse.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /tv/${tmdbId} error: ${showResponse.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB API error: ${showResponse.status}`);
        }
        const showData = await showResponse.json();

        const episodeResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum}?api_key=${tmdbApiKey}`,
            { signal: AbortSignal.timeout(8000) }
        );
        if (!episodeResponse.ok) {
            const errorText = await episodeResponse.text().catch(() => 'Unable to read error');
            console.error(`❌ [TMDB] /tv/${tmdbId}/season/${seasonNum}/episode/${episodeNum} error: ${episodeResponse.status} - ${errorText.substring(0, 200)}`);
            throw new Error(`TMDB episode API error: ${episodeResponse.status}`);
        }
        const episodeData = await episodeResponse.json();

        return {
            showTitle: showData.name,
            episodeTitle: episodeData.name,
            seasonNumber: seasonNum,
            episodeNumber: episodeNum,
            airDate: episodeData.air_date,
            imdbId: showData.external_ids?.imdb_id
        };
    } catch (error) {
        console.warn('⚠️ TMDB TV fetch warning (will use fallback):', error.message);
        return null;
    }
}

// ✅ Enhanced search endpoint for testing
async function handleSearch({ query, type }, config) {
    if (!query) throw new Error('Missing required parameter: query');
    if (!['movie', 'series', 'anime'].includes(type)) throw new Error('Invalid type. Must be "movie", "series", or "anime"');

    console.log(`🔍 Handling search: "${query}" (${type})`);
    
    try {
        // --- MODIFICA: RICERCA E ORDINAMENTO SEPARATO ---
        const [uindexResults, corsaroNeroResults, knabenResults] = await Promise.allSettled([
            fetchUIndexData(query, type, null), // italianTitle non è disponibile qui
            fetchCorsaroNeroData(query, type), // Non richiede config
            fetchKnabenData(query, type)      // Non richiede config
        ]);

        let corsaroAggregatedResults = [];
        if (corsaroNeroResults.status === 'fulfilled' && corsaroNeroResults.value) {
            corsaroAggregatedResults.push(...corsaroNeroResults.value);
        }

        let uindexAggregatedResults = [];
        if (uindexResults.status === 'fulfilled' && uindexResults.value) {
            uindexAggregatedResults.push(...uindexResults.value);
        }

        let knabenAggregatedResults = [];
        if (knabenResults.status === 'fulfilled' && knabenResults.value) {
            knabenAggregatedResults.push(...knabenResults.value);
        }

        // Deduplicate and sort
        const seenHashes = new Set();
        
        const uniqueCorsaro = corsaroAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedCorsaro = sortByQualityAndSeeders(uniqueCorsaro);
        const limitedCorsaro = limitResultsByLanguageAndQuality(sortedCorsaro, 5, 2);

        const uniqueUindex = uindexAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedUindex = sortByQualityAndSeeders(uniqueUindex);
        const limitedUindex = limitResultsByLanguageAndQuality(sortedUindex, 5, 2);

        const uniqueKnaben = knabenAggregatedResults.filter(r => {
            if (!r.infoHash || seenHashes.has(r.infoHash)) return false;
            seenHashes.add(r.infoHash);
            return true;
        });
        const sortedKnaben = sortByQualityAndSeeders(uniqueKnaben);
        const limitedKnaben = limitResultsByLanguageAndQuality(sortedKnaben, 5, 2);

        // Combina i risultati già limitati
        const results = [...limitedCorsaro, ...limitedKnaben, ...limitedUindex];
        // --- FINE MODIFICA ---

        return {
            query: query,
            type: type,
            totalResults: results.length,
            results: results.slice(0, 50).map(result => ({
                title: result.title,
                filename: result.filename,
                quality: result.quality,
                size: result.size,
                seeders: result.seeders,
                leechers: result.leechers,
                magnetLink: result.magnetLink,
                infoHash: result.infoHash,
                source: result.source
            }))
        };
    } catch (error) {
        console.error(`❌ Error in handleSearch:`, error);
        throw error;
    }
}

// ✅ Main Vercel Serverless Function handler
export default async function handler(req, res) {
    const startTime = Date.now();
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    // Set CORS headers for all responses
    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
    
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Vercel adaptation: get env from process.env
    const env = process.env;

    const url = new URL(req.url, `https://${req.headers.host}`);
    console.log(`🌐 ${req.method} ${url.pathname} - ${req.headers['user-agent']?.substring(0, 50) || 'Unknown'}`);

    // ✅ Serve la pagina di configurazione alla root
    if (url.pathname === '/') {
        try {
            // Vercel adaptation: read template.html from the filesystem
            const templatePath = path.join(process.cwd(), 'template.html');
            const templateHtml = await fs.readFile(templatePath, 'utf-8');
            res.setHeader('Content-Type', 'text/html;charset=UTF-8');
            return res.status(200).send(templateHtml);
        } catch (e) {
             console.error("Error reading template.html:", e);
             return res.status(500).send('Template not found.');
        }
    }

    // ✅ Configure endpoint - Opens with existing config preloaded
    if (url.pathname === '/configure' || url.pathname.endsWith('/configure')) {
        try {
            let existingConfig = null;
            
            // DEBUG: Log full request details
            console.log('🔍 [Configure] Request URL:', url.href);
            console.log('🔍 [Configure] Pathname:', url.pathname);
            console.log('🔍 [Configure] Search params:', Array.from(url.searchParams.entries()));
            
            // Method 1: Check if config is in path (/{config}/configure)
            const pathParts = url.pathname.split('/');
            if (pathParts.length >= 2 && pathParts[1] && pathParts[1] !== 'configure') {
                try {
                    existingConfig = JSON.parse(atob(pathParts[1]));
                    console.log('📝 [Configure] Loaded existing config from URL path');
                } catch (e) {
                    console.warn('⚠️ [Configure] Failed to parse config from path:', e.message);
                }
            }
            
            // Method 2: Check query parameter (Stremio uses ?config=)
            if (!existingConfig && url.searchParams.has('config')) {
                try {
                    const configParam = url.searchParams.get('config');
                    existingConfig = JSON.parse(atob(configParam));
                    console.log('📝 [Configure] Loaded existing config from query parameter');
                } catch (e) {
                    console.warn('⚠️ [Configure] Failed to parse config from query:', e.message);
                }
            }
            
            if (existingConfig) {
                console.log('✅ [Configure] Config loaded:', Object.keys(existingConfig));
            } else {
                console.log('ℹ️ [Configure] No existing config found - showing blank form');
            }
            
            // Read template and inject existing config as JSON
            const templatePath = path.join(process.cwd(), 'template.html');
            let templateHtml = await fs.readFile(templatePath, 'utf-8');
            
            // Inject existing config into template (if present)
            if (existingConfig) {
                const configJson = JSON.stringify(existingConfig);
                // Insert script before </body> to preload config
                const configScript = `
                    <script>
                    window.EXISTING_CONFIG = ${configJson};
                    console.log('✅ Existing configuration loaded:', window.EXISTING_CONFIG);
                    </script>
                `;
                templateHtml = templateHtml.replace('</body>', `${configScript}</body>`);
            }
            
            res.setHeader('Content-Type', 'text/html;charset=UTF-8');
            return res.status(200).send(templateHtml);
        } catch (e) {
            console.error("Error reading template.html:", e);
            return res.status(500).send('Template not found.');
        }
    }

    // ✅ Serve static logo files (with or without config prefix)
    if (url.pathname.endsWith('/logo.png') || url.pathname.endsWith('/prisonmike.png')) {
        try {
            // Extract filename from end of path
            const filename = url.pathname.endsWith('/logo.png') ? 'logo.png' : 'prisonmike.png';
            const logoPath = path.join(process.cwd(), 'public', filename);
            
            console.log(`🖼️ [Logo] Serving ${filename} from ${logoPath}`);
            
            try {
                const logoData = await fs.readFile(logoPath);
                res.setHeader('Content-Type', 'image/png');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                return res.status(200).send(logoData);
            } catch (err) {
                console.warn(`⚠️ Logo file not found: ${filename}`, err.message);
                res.setHeader('Content-Type', 'text/plain');
                return res.status(404).send('Logo not found');
            }
        } catch (e) {
            console.error('Error serving logo:', e);
            return res.status(500).send('Error serving logo');
        }
    }

    // ✅ MediaFlow Proxy Endpoint - Server-side proxying
    try {
        // Stremio manifest
        // Gestisce sia /manifest.json che /{config}/manifest.json
        if (url.pathname.endsWith('/manifest.json')) {
            const manifest = {
                id: 'community.ilcorsaroviola..ita',
                version: '1.0.0',
                name: 'IlCorsaroViola',
                description: 'Streaming da UIndex, CorsaroNero DB local, Knaben e Jackettio con o senza Real-Debrid, Torbox e Alldebrid.',
                logo: `${url.origin}/logo.png`,
                resources: ['stream'],
                types: ['movie', 'series', 'anime'],
                idPrefixes: ['tt', 'kitsu'],
                catalogs: [],
                behaviorHints: {
                    adult: false,
                    p2p: true, // Indica che può restituire link magnet
                    configurable: true, // ✅ Abilita pulsante "Configure" in Stremio
                    configurationRequired: false // ✅ Non obbligatorio, ma disponibile
                }
            };

            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(manifest, null, 2));
        }

        // Stream endpoint (main functionality)
        // Gestisce il formato /{config}/stream/{type}/{id} inviato da Stremio
        if (url.pathname.includes('/stream/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', '{config}', 'stream', '{type}', '{id}.json']

            // Estrae la configurazione dal primo segmento del path
            const encodedConfigStr = pathParts[1]; 
            let config = {};
            if (encodedConfigStr) {
                try {
                    config = JSON.parse(atob(encodedConfigStr));
                } catch (e) {
                    console.error("Errore nel parsing della configurazione (segmento 1) dall'URL:", e);
                }
            }

            // ✅ Add Jackettio ENV vars if available (fallback for private use)
            if (env.JACKETT_URL && env.JACKETT_API_KEY) {
                config.jackett_url = env.JACKETT_URL;
                config.jackett_api_key = env.JACKETT_API_KEY;
                config.jackett_password = env.JACKETT_PASSWORD; // Optional
                console.log('🔍 [Jackettio] Using ENV configuration');
            }

            // ✅ Add MediaFlow Proxy ENV vars if available (for RD sharing)
            if (env.MEDIAFLOW_URL && env.MEDIAFLOW_PASSWORD) {
                config.mediaflow_url = env.MEDIAFLOW_URL;
                config.mediaflow_password = env.MEDIAFLOW_PASSWORD;
                console.log('🔀 [MediaFlow] Using ENV configuration for RD sharing');
            }

            // Estrae tipo e id dalle posizioni corrette
            const type = pathParts[3];
            const idWithSuffix = pathParts[4] || '';
            const id = idWithSuffix.replace(/\.json$/, '');

            if (!type || !id || id.includes('config=')) { // Aggiunto controllo per evitare ID errati
                res.setHeader('Content-Type', 'application/json');
                return res.status(400).send(JSON.stringify({ streams: [], error: 'Invalid stream path' }));
            }

            // Passa la configurazione estratta (o un oggetto vuoto) a handleStream.
            // Usa solo la configurazione dall'URL, senza fallback.
            const result = await handleStream(type, id, config, url.origin);
            const responseTime = Date.now() - startTime;
            
            console.log(`✅ Stream request completed in ${responseTime}ms`);
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Response-Time', `${responseTime}ms`);
            res.setHeader('X-Results-Count', result.streams?.length || 0);
            return res.status(200).send(JSON.stringify(result));
        }
        
        // ✅ UNIFIED Real-Debrid Stream Endpoint
        if (url.pathname.startsWith('/rd-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            const seasonOrPackFlag = pathParts[4] ? pathParts[4] : null; // 'pack' or season number
            const episodeOrFileIdx = pathParts[5] ? parseInt(pathParts[5]) : null; // episode number or fileIdx for pack
            
            // Determine type and extract parameters
            let type, season, episode, packFileIdx;
            if (seasonOrPackFlag === 'pack') {
                // Movie pack: /rd-stream/config/magnet/pack/0
                type = 'movie';
                packFileIdx = episodeOrFileIdx;
                season = null;
                episode = null;
            } else if (seasonOrPackFlag !== null && episodeOrFileIdx !== null) {
                // Series: /rd-stream/config/magnet/1/5
                type = 'series';
                season = parseInt(seasonOrPackFlag);
                episode = episodeOrFileIdx;
                packFileIdx = null;
            } else {
                // Single movie: /rd-stream/config/magnet
                type = 'movie';
                season = null;
                episode = null;
                packFileIdx = null;
            }
            
            const workerOrigin = url.origin;
            
            // Initialize database for cache tracking
            let dbEnabled = false;
            try {
                dbHelper.initDatabase();
                dbEnabled = true;
            } catch (error) {
                console.warn('⚠️ [DB] Failed to initialize database for /rd-stream/');
            }
            
            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.rd_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Real-Debrid non è stata configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const realdebrid = new RealDebrid(userConfig.rd_key);
                
                console.log(`[RealDebrid] Resolving ${infoHash}`);
                
                // 🔥 SMART REUSE: Use existing torrent but ensure ALL files are selected
                let torrentId;
                const existingTorrent = await realdebrid._findExistingTorrent(infoHash);
                
                if (existingTorrent && existingTorrent.status !== 'error') {
                    torrentId = existingTorrent.id;
                    console.log(`♻️ [RD] Reusing existing torrent: ${torrentId} (status: ${existingTorrent.status})`);
                } else {
                    // STEP 1: Add magnet (RD will use cache if available)
                    console.log(`[RealDebrid] Adding new magnet...`);
                    try {
                        const addResponse = await realdebrid.addMagnet(magnetLink);
                        torrentId = addResponse.id;
                    } catch (addError) {
                        // 🔥 Handle error 19: torrent already exists
                        if (addError.error_code === 19) {
                            console.log(`[RealDebrid] Error 19: torrent already added, finding existing...`);
                            const retryTorrent = await realdebrid._findExistingTorrent(infoHash);
                            if (retryTorrent) torrentId = retryTorrent.id;
                        } else {
                            throw addError;
                        }
                    }
                }
                
                if (!torrentId) throw new Error('Failed to get torrent ID');
                
                // STEP 2: Get torrent info
                let torrent = await realdebrid.getTorrentInfo(torrentId);
                
                // STEP 3: Handle file selection if needed (like Torrentio _selectTorrentFiles)
                let targetFile = null;
                
                if (torrent.status === 'waiting_files_selection') {
                    console.log(`[RealDebrid] Selecting files...`);
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                    
                    const videoFiles = (torrent.files || [])
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext));
                        })
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return !junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => b.bytes - a.bytes);
                    
                    // ✅ PRIORITY 1: For movie packs, use packFileIdx if provided
                    if (type === 'movie' && packFileIdx !== null && packFileIdx !== undefined) {
                        console.log(`[RealDebrid] 🎬 Pack movie - selecting file at index ${packFileIdx}`);
                        targetFile = videoFiles[packFileIdx];
                        if (targetFile) {
                            console.log(`[RealDebrid] ✅ Selected pack file [${packFileIdx}]: ${targetFile.path} (${(targetFile.bytes / 1024 / 1024).toFixed(0)}MB)`);
                        } else {
                            console.log(`[RealDebrid] ❌ Pack file index ${packFileIdx} not found! Available: ${videoFiles.length} files`);
                            videoFiles.forEach((f, i) => {
                                console.log(`  [${i}] ${f.path.split('/').pop()} (${(f.bytes / 1024 / 1024).toFixed(0)}MB)`);
                            });
                        }
                    }
                    
                    // ✅ PRIORITY 2: For series episodes, use pattern matching to find the correct file
                    if (!targetFile && season && episode) {
                        const seasonStr = String(season).padStart(2, '0');
                        const episodeStr = String(episode).padStart(2, '0');
                        console.log(`[RealDebrid] 🔍 Looking for S${seasonStr}E${episodeStr} (patterns: s${seasonStr}e${episodeStr}, ${season}x${episodeStr}, ${season}x${episode}, episodio.${episode})`);
                        
                        // Log all available files for debugging
                        console.log(`[RealDebrid] 📂 Available files (${videoFiles.length}):`);
                        videoFiles.forEach((f, i) => {
                            const filename = f.path.split('/').pop();
                            console.log(`  ${i + 1}. ${filename} (${(f.bytes / 1024 / 1024).toFixed(0)}MB)`);
                        });
                        
                        // Try to find file matching the episode with multiple patterns
                        targetFile = videoFiles.find(file => {
                            const lowerPath = file.path.toLowerCase();
                            const lowerFilename = file.path.split('/').pop().toLowerCase();
                            
                            // Patterns to match (in order of specificity)
                            const matches = (
                                // Standard: S08E02
                                lowerPath.includes(`s${seasonStr}e${episodeStr}`) ||
                                // Compact: 8x02 (with leading zero)
                                lowerPath.includes(`${season}x${episodeStr}`) ||
                                // Compact: 8x2 (without leading zero)
                                lowerPath.includes(`${season}x${episode}`) ||
                                // Dotted: s08.e02
                                lowerPath.includes(`s${seasonStr}.e${episodeStr}`) ||
                                // Spaced: Season 8 Episode 2
                                lowerPath.includes(`season ${season} episode ${episode}`) ||
                                lowerPath.includes(`season${season}episode${episode}`) ||
                                // Italian: Stagione 8 Episodio 2
                                lowerPath.includes(`stagione ${season} episodio ${episode}`) ||
                                lowerPath.includes(`stagione${season}episodio${episode}`) ||
                                // Episodio: episodio.2
                                lowerPath.includes(`episodio.${episode}`) ||
                                lowerPath.includes(`episodio ${episode}`) ||
                                // Compact numbers: 802 (with word boundaries)
                                new RegExp(`[^0-9]${season}${episodeStr}[^0-9]`).test(lowerPath) ||
                                // Alternative formats
                                lowerPath.includes(`ep${episodeStr}`) && lowerPath.includes(`s${seasonStr}`) ||
                                lowerPath.includes(`e${episodeStr}`) && lowerPath.includes(`s${seasonStr}`) ||
                                // Episode without leading zero: ep2, e2
                                lowerPath.includes(`ep${episode}`) && lowerPath.includes(`s${seasonStr}`) ||
                                lowerPath.includes(`e${episode}`) && lowerPath.includes(`s${seasonStr}`)
                            );
                            
                            if (matches) {
                                console.log(`[RealDebrid] ✅ MATCHED: ${file.path}`);
                            }
                            
                            return matches;
                        });
                        
                        if (targetFile) {
                            console.log(`[RealDebrid] ✅ Selected episode file: ${targetFile.path}`);
                        } else {
                            console.log(`[RealDebrid] ❌ NO MATCH FOUND - Pattern matching failed for S${seasonStr}E${episodeStr}`);
                            console.log(`[RealDebrid] ⚠️ Falling back to largest file (this is probably wrong!)`);
                        }
                    }
                    
                    // ✅ PRIORITY 3: Fallback - use largest file
                    if (!targetFile) {
                        targetFile = videoFiles[0] || torrent.files.sort((a, b) => b.bytes - a.bytes)[0];
                        if (season && episode) {
                            console.log(`[RealDebrid] ⚠️ Fallback: Using largest video file`);
                        }
                    }
                    
                    if (targetFile) {
                        // ✅ For series: Select ALL video files (not just target) so all episodes are available
                        if (type === 'series' && videoFiles.length > 1) {
                            const allVideoIds = videoFiles.map(f => f.id).join(',');
                            console.log(`[RealDebrid] 📦 Selecting all ${videoFiles.length} video files for series pack`);
                            await realdebrid.selectFiles(torrent.id, allVideoIds);
                        } else {
                            // For movies or single-file torrents, select only the target
                            await realdebrid.selectFiles(torrent.id, targetFile.id);
                        }
                        torrent = await realdebrid.getTorrentInfo(torrent.id);
                    }
                }
                
                // STEP 4: Check torrent status (like Torrentio statusReady/statusDownloading)
                const statusReady = ['downloaded', 'dead'].includes(torrent.status);
                const statusDownloading = ['downloading', 'uploading', 'queued'].includes(torrent.status);
                const statusMagnetError = torrent.status === 'magnet_error';
                const statusError = ['error', 'magnet_error'].includes(torrent.status);
                const statusOpening = torrent.status === 'magnet_conversion';
                const statusWaitingSelection = torrent.status === 'waiting_files_selection';
                
                if (statusReady) {
                    // ✅ READY: Unrestrict and stream
                    console.log(`[RealDebrid] Torrent ready, unrestricting...`);
                    
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                    
                    const selectedFiles = (torrent.files || []).filter(file => file.selected === 1);
                    const allVideoFiles = (torrent.files || []).filter(file => {
                        const lowerPath = file.path.toLowerCase();
                        return videoExtensions.some(ext => lowerPath.endsWith(ext)) &&
                               (!junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024);
                    });
                    
                    const videos = selectedFiles
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext));
                        })
                        .filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return !junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => b.bytes - a.bytes);
                    
                    // 🔥 CRITICAL FIX: If series pack has incomplete file selection, add missing files
                    if (type === 'series' && videos.length < allVideoFiles.length && allVideoFiles.length > 1) {
                        console.log(`⚠️ [RD] Incomplete file selection: ${videos.length}/${allVideoFiles.length} videos selected`);
                        console.log(`🔄 [RD] Adding ${allVideoFiles.length - videos.length} missing video files...`);
                        
                        const allVideoIds = allVideoFiles.map(f => f.id).join(',');
                        await realdebrid.selectFiles(torrent.id, allVideoIds);
                        
                        // Re-fetch torrent info with updated selection
                        torrent = await realdebrid.getTorrentInfo(torrent.id);
                        console.log(`✅ [RD] Updated file selection: ${allVideoFiles.length} videos now selected`);
                        
                        // Refresh videos list
                        const updatedSelectedFiles = (torrent.files || []).filter(file => file.selected === 1);
                        videos.length = 0; // Clear array
                        videos.push(...updatedSelectedFiles
                            .filter(file => {
                                const lowerPath = file.path.toLowerCase();
                                return videoExtensions.some(ext => lowerPath.endsWith(ext));
                            })
                            .filter(file => {
                                const lowerPath = file.path.toLowerCase();
                                return !junkKeywords.some(junk => lowerPath.includes(junk)) || file.bytes > 250 * 1024 * 1024;
                            })
                            .sort((a, b) => b.bytes - a.bytes));
                    }
                    
                    let targetFile = null;
                    
                    // ✅ For series episodes, use pattern matching to find the correct file
                    if (season && episode) {
                        const seasonStr = String(season).padStart(2, '0');
                        const episodeStr = String(episode).padStart(2, '0');
                        console.log(`[RealDebrid] 🔍 Looking for S${seasonStr}E${episodeStr} (patterns: s${seasonStr}e${episodeStr}, ${season}x${episodeStr}, ${season}x${episode}, episodio.${episode})`);
                        
                        // Log all available files for debugging
                        console.log(`[RealDebrid] 📂 Selected files (${videos.length}):`);
                        videos.forEach((f, i) => {
                            const filename = f.path.split('/').pop();
                            console.log(`  ${i + 1}. ${filename} (${(f.bytes / 1024 / 1024).toFixed(0)}MB)`);
                        });
                        
                        targetFile = videos.find(file => {
                            const lowerPath = file.path.toLowerCase();
                            const lowerFilename = file.path.split('/').pop().toLowerCase();
                            
                            // Patterns to match (in order of specificity)
                            const matches = (
                                // Standard: S08E02
                                lowerPath.includes(`s${seasonStr}e${episodeStr}`) ||
                                // Compact: 8x02 (with leading zero)
                                lowerPath.includes(`${season}x${episodeStr}`) ||
                                // Compact: 8x2 (without leading zero)
                                lowerPath.includes(`${season}x${episode}`) ||
                                // Dotted: s08.e02
                                lowerPath.includes(`s${seasonStr}.e${episodeStr}`) ||
                                // Spaced: Season 8 Episode 2
                                lowerPath.includes(`season ${season} episode ${episode}`) ||
                                lowerPath.includes(`season${season}episode${episode}`) ||
                                // Italian: Stagione 8 Episodio 2
                                lowerPath.includes(`stagione ${season} episodio ${episode}`) ||
                                lowerPath.includes(`stagione${season}episodio${episode}`) ||
                                // Episodio: episodio.2
                                lowerPath.includes(`episodio.${episode}`) ||
                                lowerPath.includes(`episodio ${episode}`) ||
                                // Compact numbers: 802 (with word boundaries)
                                new RegExp(`[^0-9]${season}${episodeStr}[^0-9]`).test(lowerPath) ||
                                // Alternative formats
                                lowerPath.includes(`ep${episodeStr}`) && lowerPath.includes(`s${seasonStr}`) ||
                                lowerPath.includes(`e${episodeStr}`) && lowerPath.includes(`s${seasonStr}`) ||
                                // Episode without leading zero: ep2, e2
                                lowerPath.includes(`ep${episode}`) && lowerPath.includes(`s${seasonStr}`) ||
                                lowerPath.includes(`e${episode}`) && lowerPath.includes(`s${seasonStr}`)
                            );
                            
                            if (matches) {
                                console.log(`[RealDebrid] ✅ MATCHED: ${file.path}`);
                            }
                            
                            return matches;
                        });
                        
                        if (targetFile) {
                            console.log(`[RealDebrid] ✅ Selected episode file: ${targetFile.path}`);
                        } else {
                            console.log(`[RealDebrid] ❌ NO MATCH FOUND - Pattern matching failed for S${seasonStr}E${episodeStr}`);
                            console.log(`[RealDebrid] ⚠️ Falling back to largest file (this is probably wrong!)`);
                            
                            // 🔥 SMART FIX: For series, if episode not found, delete torrent and re-add with all files
                            if (type === 'series' && selectedFiles.length < 5) { // Probably only 1 episode was selected
                                console.log(`[RealDebrid] 🔄 Torrent has only ${selectedFiles.length} selected file(s), re-adding to select all episodes...`);
                                
                                try {
                                    // Delete the existing torrent
                                    await realdebrid.deleteTorrent(torrent.id);
                                    console.log(`[RealDebrid] 🗑️ Deleted torrent ${torrent.id}`);
                                    
                                    // Re-add the magnet and force file selection
                                    console.log(`[RealDebrid] ➕ Re-adding magnet to select all files...`);
                                    const newTorrent = await realdebrid.addMagnet(magnetLink);
                                    
                                    // Wait for magnet conversion
                                    let retries = 0;
                                    let convertedTorrent = newTorrent;
                                    while (convertedTorrent.status === 'magnet_conversion' && retries < 10) {
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                        convertedTorrent = await realdebrid.getTorrentInfo(newTorrent.id);
                                        retries++;
                                    }
                                    
                                    if (convertedTorrent.status === 'waiting_files_selection') {
                                        // Select ALL video files
                                        const allFiles = convertedTorrent.files || [];
                                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                                        const allVideoFiles = allFiles.filter(file => {
                                            const lowerPath = file.path.toLowerCase();
                                            return videoExtensions.some(ext => lowerPath.endsWith(ext));
                                        });
                                        
                                        if (allVideoFiles.length > 0) {
                                            const allVideoIds = allVideoFiles.map(f => f.id).join(',');
                                            console.log(`[RealDebrid] 📦 Selecting all ${allVideoFiles.length} video files`);
                                            await realdebrid.selectFiles(convertedTorrent.id, allVideoIds);
                                            
                                            // ✅ SAVE FILE INFO: Save ALL files from the pack NOW (before redirect)
                                            if (dbEnabled && infoHash) {
                                                try {
                                                    const episodeImdbId = await dbHelper.getImdbIdByHash(infoHash);
                                                    
                                                    if (episodeImdbId) {
                                                        console.log(`💾 [DB] Saving ALL ${allVideoFiles.length} files from re-added pack...`);
                                                        
                                                        for (const file of allVideoFiles) {
                                                            const filename = file.path.split('/').pop();
                                                            const episodeMatch = filename.match(/[se](\d{1,2})[ex](\d{1,2})|stagione[\s._-]*(\d{1,2})[\s._-]*episodio[\s._-]*(\d{1,2})|(\d{1,2})x(\d{1,2})/i);
                                                            
                                                            if (episodeMatch) {
                                                                let fileSeason, fileEpisode;
                                                                if (episodeMatch[1] && episodeMatch[2]) {
                                                                    fileSeason = parseInt(episodeMatch[1]);
                                                                    fileEpisode = parseInt(episodeMatch[2]);
                                                                } else if (episodeMatch[3] && episodeMatch[4]) {
                                                                    fileSeason = parseInt(episodeMatch[3]);
                                                                    fileEpisode = parseInt(episodeMatch[4]);
                                                                } else if (episodeMatch[5] && episodeMatch[6]) {
                                                                    fileSeason = parseInt(episodeMatch[5]);
                                                                    fileEpisode = parseInt(episodeMatch[6]);
                                                                }
                                                                
                                                                if (fileSeason === parseInt(season)) {
                                                                    const fileInfo = {
                                                                        imdbId: episodeImdbId,
                                                                        season: fileSeason,
                                                                        episode: fileEpisode
                                                                    };
                                                                    
                                                                    await dbHelper.updateTorrentFileInfo(
                                                                        infoHash,
                                                                        file.id,
                                                                        file.path,
                                                                        fileInfo
                                                                    );
                                                                    
                                                                    console.log(`💾 [DB] Saved S${String(fileSeason).padStart(2, '0')}E${String(fileEpisode).padStart(2, '0')}: ${filename}`);
                                                                }
                                                            }
                                                        }
                                                        
                                                        console.log(`✅ [DB] Finished saving all files from re-added pack`);
                                                    }
                                                } catch (fileErr) {
                                                    console.error(`❌ [DB] Error saving pack files: ${fileErr.message}`);
                                                }
                                            }
                                            
                                            // Redirect to same URL to restart the flow
                                            console.log(`[RealDebrid] 🔄 Reloading stream with all files selected...`);
                                            return res.redirect(302, req.url);
                                        }
                                    }
                                    
                                    console.log(`[RealDebrid] ❌ Failed to re-add torrent properly`);
                                } catch (error) {
                                    console.error(`[RealDebrid] ❌ Error re-adding torrent:`, error.message);
                                }
                            }
                        }
                    }
                    
                    // ✅ PRIORITY 3: Fallback - use largest file
                    if (!targetFile) {
                        targetFile = videos[0] || selectedFiles.sort((a, b) => b.bytes - a.bytes)[0];
                        if (season && episode) {
                            console.log(`[RealDebrid] ⚠️ Fallback: Using largest video file`);
                        }
                    }
                    
                    if (!targetFile) {
                        console.log(`[RealDebrid] No video file found`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    
                    // 🔥 CRITICAL FIX: Use SELECTED files to find the correct link index!
                    // RealDebrid returns links[] array ONLY for selected files (selected=1)
                    // We need to find which position our targetFile is AMONG SELECTED FILES
                    const selectedForLink = (torrent.files || []).filter(f => f.selected === 1);
                    const fileIndex = selectedForLink.findIndex(f => f.id === targetFile.id);
                    
                    if (fileIndex === -1) {
                        console.log(`[RealDebrid] ❌ Target file not in selected files (file.id=${targetFile.id})`);
                        console.log(`[RealDebrid] Selected files: ${selectedForLink.map(f => `${f.id}:${f.path.split('/').pop()}`).join(', ')}`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    
                    console.log(`[RealDebrid] 📍 File ID: ${targetFile.id}, Selected Index: ${fileIndex}/${selectedForLink.length}, Total links: ${(torrent.links || []).length}`);
                    
                    let downloadLink = torrent.links[fileIndex];
                    
                    if (!downloadLink) {
                        console.log(`[RealDebrid] ❌ No download link at index ${fileIndex}`);
                        console.log(`[RealDebrid] Available links: ${(torrent.links || []).length}`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    
                    console.log(`[RealDebrid] ✅ Using link at index ${fileIndex} for file: ${targetFile.path.split('/').pop()}`);
                    
                    const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                    
                    // 🔥 Torrentio-style: Check for access denied errors
                    if (realdebrid._isAccessDeniedError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Access denied (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/access_denied_v2.mp4`);
                    }
                    
                    // 🔥 Torrentio-style: Check for infringing file errors
                    if (realdebrid._isInfringingFileError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Infringing file (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/infringing_file_v2.mp4`);
                    }
                    
                    // 🔥 Torrentio-style: Check for limit exceeded
                    if (realdebrid._isLimitExceededError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Limit exceeded (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/limit_exceeded_v2.mp4`);
                    }
                    
                    // 🔥 Torrentio-style: Check for torrent too big
                    if (realdebrid._isTorrentTooBigError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Torrent too big (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/torrent_too_big_v2.mp4`);
                    }
                    
                    // 🔥 Torrentio-style: Check for failed download
                    if (realdebrid._isFailedDownloadError(unrestricted)) {
                        console.log(`[RealDebrid] ❌ Failed download (error ${unrestricted.error_code})`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    
                    // ✅ CACHE SUCCESS: Mark torrent as cached in DB (5-day TTL)
                    if (dbEnabled && infoHash) {
                        try {
                            // Update cache status only (not file-specific data)
                            await dbHelper.updateRdCacheStatus([{ hash: infoHash, cached: true }]);
                            console.log(`💾 [DB] Marked ${infoHash} as RD cached (5-day TTL)`);
                        } catch (dbErr) {
                            console.error(`❌ [DB] Error updating DB: ${dbErr.message}`, dbErr);
                        }
                        
                        // ✅ SAVE FILE INFO: Save ALL files from the pack for future lookups
                        if (type === 'series' && season && torrent && torrent.files) {
                            try {
                                // Get imdbId from DB for this torrent
                                const episodeImdbId = await dbHelper.getImdbIdByHash(infoHash);
                                
                                if (episodeImdbId) {
                                    console.log(`💾 [DB] Saving ALL ${torrent.files.length} files from pack...`);
                                    
                                    // Iterate through ALL files in the pack
                                    for (const file of torrent.files) {
                                        // Only process video files
                                        if (!file.path.match(/\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i)) {
                                            continue;
                                        }
                                        
                                        // Try to extract episode number from filename
                                        const filename = file.path.split('/').pop();
                                        const episodeMatch = filename.match(/[se](\d{1,2})[ex](\d{1,2})|stagione[\s._-]*(\d{1,2})[\s._-]*episodio[\s._-]*(\d{1,2})|(\d{1,2})x(\d{1,2})/i);
                                        
                                        if (episodeMatch) {
                                            // Extract season and episode from match
                                            let fileSeason, fileEpisode;
                                            if (episodeMatch[1] && episodeMatch[2]) {
                                                fileSeason = parseInt(episodeMatch[1]);
                                                fileEpisode = parseInt(episodeMatch[2]);
                                            } else if (episodeMatch[3] && episodeMatch[4]) {
                                                fileSeason = parseInt(episodeMatch[3]);
                                                fileEpisode = parseInt(episodeMatch[4]);
                                            } else if (episodeMatch[5] && episodeMatch[6]) {
                                                fileSeason = parseInt(episodeMatch[5]);
                                                fileEpisode = parseInt(episodeMatch[6]);
                                            }
                                            
                                            // Only save if it matches the current season
                                            if (fileSeason === parseInt(season)) {
                                                const fileInfo = {
                                                    imdbId: episodeImdbId,
                                                    season: fileSeason,
                                                    episode: fileEpisode
                                                };
                                                
                                                await dbHelper.updateTorrentFileInfo(
                                                    infoHash,
                                                    file.id,
                                                    file.path,
                                                    fileInfo
                                                );
                                                
                                                console.log(`💾 [DB] Saved S${String(fileSeason).padStart(2, '0')}E${String(fileEpisode).padStart(2, '0')}: ${filename}`);
                                            }
                                        }
                                    }
                                    
                                    console.log(`✅ [DB] Finished saving all files from pack`);
                                } else {
                                    console.warn(`⚠️ [DB] No imdbId found for pack, skipping bulk save`);
                                }
                            } catch (fileErr) {
                                console.error(`❌ [DB] Error saving pack files: ${fileErr.message}`);
                            }
                        }
                    }
                    
                    // Check if it's a RAR archive
                    if (unrestricted.download?.endsWith('.rar') || unrestricted.download?.endsWith('.zip')) {
                        console.log(`[RealDebrid] Failed: RAR archive`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                    }
                    
                    let finalUrl = unrestricted.download;
                    
                    // IMPORTANT: Apply MediaFlow proxy for ALL RealDebrid streams if configured
                    if (userConfig.mediaflow_url && userConfig.mediaflow_password) {
                        try {
                            finalUrl = await proxyThroughMediaFlow(
                                unrestricted.download,
                                { url: userConfig.mediaflow_url, password: userConfig.mediaflow_password },
                                null // filename will be extracted from URL
                            );
                            console.log(`[RealDebrid] MediaFlow proxy applied to all streams`);
                        } catch (mfError) {
                            console.warn(`[RealDebrid] MediaFlow proxy failed: ${mfError.message}`);
                            // Keep original URL if MediaFlow fails
                        }
                    }
                    
                    console.log(`[RealDebrid] Redirecting to stream`);
                    return res.redirect(302, finalUrl);
                    
                } else if (statusDownloading || statusOpening || statusWaitingSelection) {
                    // ⏳ DOWNLOADING: Show placeholder video
                    console.log(`[RealDebrid] Torrent is downloading (status: ${torrent.status})...`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                    
                } else if (statusMagnetError) {
                    // ❌ MAGNET ERROR: Show failed opening video
                    console.log(`[RealDebrid] Magnet error`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_opening_v2.mp4`);
                    
                } else if (statusError) {
                    // ❌ ERROR: Show failed video
                    console.log(`[RealDebrid] Torrent failed`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
                // Fallback: something went wrong
                console.log(`[RealDebrid] Unknown state (${torrent.status}), showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);

            } catch (error) {
                console.error('🔵 ❌ RD stream error:', error);
                
                // 🔥 Torrentio-style: Check for specific error codes
                const realdebrid = new RealDebrid(userConfig.rd_key || '');
                
                if (realdebrid._isAccessDeniedError(error)) {
                    console.log(`[RealDebrid] ❌ Access denied (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/access_denied_v2.mp4`);
                }
                
                if (realdebrid._isInfringingFileError(error)) {
                    console.log(`[RealDebrid] ❌ Infringing file (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/infringing_file_v2.mp4`);
                }
                
                if (realdebrid._isLimitExceededError(error)) {
                    console.log(`[RealDebrid] ❌ Limit exceeded (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/limit_exceeded_v2.mp4`);
                }
                
                if (realdebrid._isTorrentTooBigError(error)) {
                    console.log(`[RealDebrid] ❌ Torrent too big (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/torrent_too_big_v2.mp4`);
                }
                
                if (realdebrid._isFailedDownloadError(error)) {
                    console.log(`[RealDebrid] ❌ Failed download (error ${error.error_code})`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
                // Handle text-based error messages (legacy)
                const errorMsg = error.message?.toLowerCase() || '';
                
                if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
                    // Too many requests - show downloading placeholder
                    console.log(`[RealDebrid] Rate limited, showing downloading placeholder`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                }
                
                if (errorMsg.includes('400') || errorMsg.includes('not found') || errorMsg.includes('invalid')) {
                    // Torrent not available or invalid
                    console.log(`[RealDebrid] Torrent not available (400/404)`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
                if (errorMsg.includes('rar') || errorMsg.includes('zip')) {
                    // Archive format not supported
                    console.log(`[RealDebrid] Archive format not supported`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                }
                
                if (errorMsg.includes('magnet')) {
                    // Magnet error
                    console.log(`[RealDebrid] Magnet conversion error`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_opening_v2.mp4`);
                }
                
                // Generic error: show failed placeholder
                console.log(`[RealDebrid] Generic error, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }
        }
        
        // Endpoint to handle adding magnets to Real-Debrid for Android/Web compatibility
        if (url.pathname.startsWith('/rd-add/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-add', 'config_string', 'magnet_link']
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            const workerOrigin = url.origin; // For MediaFlow proxy URL generation
            
            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.rd_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Real-Debrid non è stata configurata. Impossibile aggiungere il torrent.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                // ... (tutta la logica interna di /rd-add/ rimane invariata) ...
                // ...

                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const realdebrid = new RealDebrid(userConfig.rd_key);

                // --- Robust Torrent Handling ---
                const userTorrents = await realdebrid.getTorrents();
                let torrent = userTorrents.find(t => t.hash.toLowerCase() === infoHash.toLowerCase());

                if (torrent) {
                    try {
                        const errorStates = ['error', 'magnet_error', 'virus', 'dead'];
                        const torrentInfo = await realdebrid.getTorrentInfo(torrent.id);
                        if (errorStates.includes(torrentInfo.status)) {
                            console.log(`🗑️ Found stale/failed torrent (ID: ${torrent.id}, Status: ${torrentInfo.status}). Deleting it.`);
                            await realdebrid.deleteTorrent(torrent.id);
                            torrent = null; // Force re-adding
                        }
                    } catch (e) {
                        console.warn(`⚠️ Could not get info for existing torrent ${torrent.id}. Deleting it as a precaution.`, e.message);
                        await realdebrid.deleteTorrent(torrent.id).catch(err => console.error(`Error during precautionary delete: ${err.message}`));
                        torrent = null; // Force re-adding
                    }
                }

                let torrentId;
                if (!torrent) {
                    console.log(`ℹ️ Adding new torrent with hash ${infoHash}.`);
                    const addResponse = await realdebrid.addMagnet(magnetLink);
                    torrentId = addResponse.id;
                    if (!torrentId) throw new Error('Impossibile ottenere l\'ID del torrent da Real-Debrid.');
                } else {
                    torrentId = torrent.id;
                    console.log(`ℹ️ Using existing torrent. ID: ${torrentId}`);
                }

                let torrentInfo;
                let actionTaken = false;
                for (let i = 0; i < 15; i++) { // Poll for up to ~30 seconds
                    if (i === 0) await new Promise(resolve => setTimeout(resolve, 1500));

                    torrentInfo = await realdebrid.getTorrentInfo(torrentId);
                    const status = torrentInfo.status;
                    console.log(`[Attempt ${i + 1}/15] Torrent ${torrentId} status: ${status}`);

                    if (status === 'waiting_files_selection') {
                        console.log(`▶️ Torrent requires file selection. Selecting main video file...`);
                        if (!torrentInfo.files || torrentInfo.files.length === 0) throw new Error('Torrent is empty or invalid.');
                        
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const videoFiles = torrentInfo.files.filter(file => {
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext)) &&
                                   !junkKeywords.some(junk => lowerPath.includes(junk));
                        });
                        
                        const fileToDownload = videoFiles.length > 0
                            ? videoFiles.reduce((max, file) => (file.bytes > max.bytes ? file : max), videoFiles[0])
                            : torrentInfo.files.reduce((max, file) => (file.bytes > max.bytes ? file : max), torrentInfo.files[0]);

                        if (!fileToDownload) throw new Error('Impossibile determinare il file da scaricare nel torrent.');
                        
                        await realdebrid.selectFiles(torrentId, fileToDownload.id);
                        console.log(`✅ Download started for file: ${fileToDownload.path}`);
                        actionTaken = true;
                        break;
                    }

                    if (['queued', 'downloading', 'downloaded'].includes(status)) {
                        console.log(`ℹ️ Torrent is already active (status: ${status}). No action needed.`);
                        actionTaken = true;
                        break;
                    }

                    if (status === 'magnet_conversion') {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }

                    const errorStates = ['error', 'magnet_error', 'virus', 'dead'];
                    if (errorStates.includes(status)) {
                        throw new Error(`Torrent has a critical error state: ${status}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                if (!actionTaken) {
                    throw new Error(`Torrent did not become active after polling. Last status: ${torrentInfo.status}`);
                }

                if (torrentInfo.status === 'downloaded') {
                    console.log('✅ Torrent already downloaded. Getting stream link directly...');
                    try {
                        if (!torrentInfo.links || torrentInfo.links.length === 0) throw new Error('Torrent scaricato ma Real-Debrid non ha fornito un link.');
                        
                        let downloadLink;
                        if (torrentInfo.links.length === 1) {
                            downloadLink = torrentInfo.links[0];
                        } else {
                            const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                            const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                            const selectedVideoFiles = torrentInfo.files.filter(file => file.selected === 1 && videoExtensions.some(ext => file.path.toLowerCase().endsWith(ext)) && !junkKeywords.some(junk => file.path.toLowerCase().includes(junk)));
                            let mainFile = selectedVideoFiles.length > 0 ? selectedVideoFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null) : torrentInfo.files.filter(f => f.selected === 1).reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);
                            if (!mainFile) throw new Error('Torrent completato ma nessun file valido risulta selezionato.');
                            const filename = mainFile.path.split('/').pop();
                            downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));
                            if (!downloadLink) throw new Error(`Could not match filename "${filename}" to any of the available links.`);
                        }

                        const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                        let finalStreamUrl = unrestricted.download;
                        
                        // ✅ CACHE SUCCESS: Mark torrent as cached in DB (5-day TTL)
                        if (dbEnabled && infoHash) {
                            try {
                                await dbHelper.updateRdCacheStatus([{ hash: infoHash, cached: true }]);
                                console.log(`💾 [DB] Marked ${infoHash} as RD cached (5-day TTL)`);
                            } catch (dbErr) {
                                console.warn(`⚠️ Failed to update DB cache status: ${dbErr.message}`);
                            }
                        }
                        
                        // Apply MediaFlow proxy if configured
                        if (userConfig.mediaflow_url && userConfig.mediaflow_password) {
                            try {
                                finalStreamUrl = await proxyThroughMediaFlow(unrestricted.download, { url: userConfig.mediaflow_url, password: userConfig.mediaflow_password }, null);
                                console.log(`🔒 Applied MediaFlow proxy to non-cached RD stream`);
                            } catch (mfError) {
                                console.error(`⚠️ Failed to apply MediaFlow proxy: ${mfError.message}`);
                                // Fallback to direct URL if MediaFlow fails
                            }
                        }
                        
                        console.log(`🚀 Redirecting directly to stream: ${finalStreamUrl}`);
                        res.setHeader('Location', finalStreamUrl);
                        return res.status(302).end();

                    } catch (redirectError) {
                        console.error(`❌ Failed to get direct stream link, falling back to polling page. Error: ${redirectError.message}`);
                    }
                }

                const pollingPage = `
                    <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Caricamento in corso...</title>
                    <style>
                        body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;}
                        .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);}
                        h1{color:#4EC9B0; margin-bottom: 0.5em;}
                        #status{font-size:1.2em; margin-top: 1em; min-height: 2em;}
                        .progress-bar{width:80%;background-color:#333;border-radius:5px;overflow:hidden;margin-top:1em;}
                        #progress{width:0%;height:20px;background-color:#4EC9B0;transition:width 0.5s ease-in-out;}
                        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #4EC9B0; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                    </head><body><div class="container">
                        <div class="loader"></div>
                        <h1>Aggiunto a Real-Debrid</h1>
                        <p>Attendi il completamento del download. Lo streaming partirà in automatico.</p>
                        <div id="status">Inizializzazione...</div>
                        <div class="progress-bar"><div id="progress"></div></div>
                    </div> 
                    <script>
                        const torrentId = '${torrentId}';
                        const statusEl = document.getElementById('status');
                        const progressEl = document.getElementById('progress');
                        let pollCount = 0;
                        const maxPolls = 180; // 30 minutes timeout (180 polls * 10 seconds)

                        function pollStatus() {
                            if (pollCount++ > maxPolls) {
                                statusEl.textContent = 'Errore: Timeout. Il download sta impiegando troppo tempo. Controlla il tuo account Real-Debrid.';
                                statusEl.style.color = '#FF6B6B';
                                return;
                            }

                            fetch('/rd-status/${encodedConfigStr}/' + torrentId)
                                .then(res => res.json())
                                .then(data => {
                                    if (data.status === 'ready' && data.url) {
                                        statusEl.textContent = 'Download completato! Avvio dello streaming...';
                                        window.location.href = data.url;
                                    } else if (data.status === 'downloading') {
                                        statusEl.textContent = \`Download in corso... \${data.progress}% (\${data.speed} KB/s)\`;
                                        progressEl.style.width = data.progress + '%';
                                        setTimeout(pollStatus, 5000); // Poll faster when downloading
                                    } else if (data.status === 'queued') {
                                        statusEl.textContent = 'In coda su Real-Debrid...';
                                        setTimeout(pollStatus, 10000); // Poll slower when queued
                                    } else if (data.status === 'magnet_conversion' || data.status === 'waiting_files_selection') {
                                        statusEl.textContent = 'Analisi del torrent in corso...';
                                        setTimeout(pollStatus, 7000);
                                    } else if (data.status === 'error') {
                                        statusEl.textContent = 'Errore: ' + data.message;
                                        statusEl.style.color = '#FF6B6B';
                                    } else {
                                        statusEl.textContent = 'Errore: stato sconosciuto (' + data.status + '). Controlla il tuo account Real-Debrid.';
                                        statusEl.style.color = '#FF6B6B';
                                    }
                                })
                                .catch(err => {
                                    statusEl.textContent = 'Errore di connessione durante il controllo dello stato.';
                                    statusEl.style.color = '#FF6B6B';
                                });
                        }
                        setTimeout(pollStatus, 2000); // Initial delay
                    </script>
                    </body></html>
                `;
                return res.status(200).send(pollingPage);

            } catch (error) {
                console.error('❌ Error adding magnet to RD:', error);
                return res.status(500).send(htmlResponse('Errore', `Impossibile aggiungere il torrent a Real-Debrid: ${error.message}`, true));
            }
        }

        // Endpoint to stream from a user's personal torrents
        if (url.pathname.startsWith('/rd-stream-personal/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-stream-personal', 'config_string', 'torrent_id']
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];
            const workerOrigin = url.origin; // For MediaFlow proxy URL generation

            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            res.setHeader('Content-Type', 'text/html');
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!torrentId) {
                return res.status(400).send(htmlResponse('Errore', 'ID torrent non valido.', true));
            }

            try {
                // ... (tutta la logica interna di /rd-stream-personal/ rimane invariata) ...
                // ...
                console.log(`👤 Streaming from personal torrent ID: ${torrentId}`);
                const realdebrid = new RealDebrid(userConfig.rd_key);
                const torrentInfo = await realdebrid.getTorrentInfo(torrentId);

                if (torrentInfo.status !== 'downloaded') {
                    throw new Error(`Il torrent non è ancora pronto. Stato: ${torrentInfo.status}. Riprova più tardi.`);
                }

                if (!torrentInfo.links || torrentInfo.links.length === 0) {
                    throw new Error('Torrent scaricato ma Real-Debrid non ha fornito un link.');
                }

                let downloadLink;
                if (torrentInfo.links.length === 1) {
                    downloadLink = torrentInfo.links[0];
                } else {
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                    let bestFile = null;
                    const selectedFiles = torrentInfo.files.filter(f => f.selected === 1);

                    for (const file of selectedFiles) {
                        const lowerPath = file.path.toLowerCase();
                        
                        const hasVideoExtension = videoExtensions.some(ext => lowerPath.endsWith(ext));
                        if (!hasVideoExtension) continue;

                        const isLikelyJunk = junkKeywords.some(junk => lowerPath.includes(junk)) && file.bytes < 250 * 1024 * 1024;
                        if (isLikelyJunk) continue;

                        if (!bestFile || file.bytes > bestFile.bytes) {
                            bestFile = file;
                        }
                    }

                    if (!bestFile) {
                        bestFile = selectedFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);
                    }

                    if (!bestFile) throw new Error('Impossibile determinare il file principale nel torrent.');

                    const filename = bestFile.path.split('/').pop();
                    downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));

                    if (!downloadLink) throw new Error(`Impossibile trovare il link per il file: ${filename}`);
                }

                const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                let finalStreamUrl = unrestricted.download;
                
                // ✅ Proxy through MediaFlow if configured
                if (userConfig.mediaflow_url && userConfig.mediaflow_password) {
                const mediaflowConfig = {
                    url: userConfig.mediaflow_url,
                    password: userConfig.mediaflow_password
                };
                finalStreamUrl = await proxyThroughMediaFlow(finalStreamUrl, mediaflowConfig, null);
            }
            
            console.log(`🚀 Redirecting to personal stream`);                res.setHeader('Location', finalStreamUrl);
                return res.status(302).end();

            } catch (error) {
                console.error('❌ Error streaming from personal RD torrent:', error);
                return res.status(500).send(htmlResponse('Errore', `Impossibile avviare lo streaming dal torrent personale: ${error.message}`, true));
            }
        }

        // Endpoint to poll torrent status
        if (url.pathname.startsWith('/rd-status/')) {
            const pathParts = url.pathname.split('/'); // e.g., ['', 'rd-status', 'config_string', 'torrent_id']
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];
            const workerOrigin = url.origin; // For MediaFlow proxy URL generation

            res.setHeader('Content-Type', 'application/json');
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(JSON.stringify({ status: 'error', message: `Configurazione non valida: ${e.message}` }));
            }

            if (!torrentId) {
                return res.status(400).send(JSON.stringify({ status: 'error', message: 'Missing torrent ID' }));
            }

            try {
                // ... (tutta la logica interna di /rd-status/ rimane invariata) ...
                // ...
                const realdebrid = new RealDebrid(userConfig.rd_key);
                const torrentInfo = await realdebrid.getTorrentInfo(torrentId);

                if (torrentInfo.links && torrentInfo.links.length > 0) {
                    let downloadLink;

                    if (torrentInfo.links.length === 1) {
                        downloadLink = torrentInfo.links[0];
                    } else {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];

                        const selectedVideoFiles = torrentInfo.files.filter(file => {
                            if (file.selected !== 1) return false;
                            const lowerPath = file.path.toLowerCase();
                            return videoExtensions.some(ext => lowerPath.endsWith(ext)) && !junkKeywords.some(junk => lowerPath.includes(junk));
                        });

                        let mainFile = selectedVideoFiles.length > 0
                            ? selectedVideoFiles.reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null)
                            : torrentInfo.files.filter(file => file.selected === 1).reduce((max, file) => (file.bytes > (max?.bytes || 0) ? file : max), null);

                        if (!mainFile) throw new Error('Torrent completato ma nessun file valido risulta selezionato.');
                        
                        const filename = mainFile.path.split('/').pop();
                        downloadLink = torrentInfo.links.find(link => decodeURIComponent(link).endsWith(filename));

                        if (!downloadLink) throw new Error(`Could not match filename "${filename}" to any of the available links.`);
                    }

                    const unrestricted = await realdebrid.unrestrictLink(downloadLink);
                    
                    let finalStreamUrl = unrestricted.download;
                    
                    // Apply MediaFlow proxy if configured
                    if (userConfig.mediaflow_url && userConfig.mediaflow_password) {
                        try {
                            finalStreamUrl = await proxyThroughMediaFlow(unrestricted.download, { url: userConfig.mediaflow_url, password: userConfig.mediaflow_password }, null);
                            console.log(`🔒 Applied MediaFlow proxy to non-cached RD stream (status check)`);
                        } catch (mfError) {
                            console.error(`⚠️ Failed to apply MediaFlow proxy: ${mfError.message}`);
                            // Fallback to direct URL if MediaFlow fails
                        }
                    }

                    return res.status(200).send(JSON.stringify({ status: 'ready', url: finalStreamUrl }));
                }

                if (['queued', 'downloading', 'magnet_conversion', 'waiting_files_selection'].includes(torrentInfo.status)) {
                    return res.status(200).send(JSON.stringify({
                        status: torrentInfo.status,
                        progress: torrentInfo.progress || 0,
                        speed: torrentInfo.speed ? Math.round(torrentInfo.speed / 1024) : 0
                    }));
                }
                
                if (torrentInfo.status === 'downloaded') {
                    throw new Error('Torrent scaricato, ma Real-Debrid non ha fornito un link valido.');
                } else {
                    throw new Error(`Stato del torrent non gestito o in errore su Real-Debrid: ${torrentInfo.status} - ${torrentInfo.error || 'Sconosciuto'}`);
                }

            } catch (error) {
                console.error(`❌ Error checking RD status for ${torrentId}:`, error);
                return res.status(500).send(JSON.stringify({ status: 'error', message: error.message }));
            }
        }

        // ✅ TORBOX ROUTES - Add torrent to Torbox
        if (url.pathname.startsWith('/torbox-add/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            
            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', `Impossibile leggere la configurazione dall'URL: ${e.message}`, true));
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send(htmlResponse('Errore di Configurazione', 'La chiave API di Torbox non è stata configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet non valido.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const torbox = new Torbox(userConfig.torbox_key);

                const userTorrents = await torbox.getTorrents();
                let torrent = userTorrents.find(t => t.hash?.toLowerCase() === infoHash.toLowerCase());

                let torrentId;
                if (!torrent) {
                    console.log(`📦 Adding new torrent to Torbox: ${infoHash}`);
                    const addResponse = await torbox.addTorrent(magnetLink);
                    torrentId = addResponse.torrent_id || addResponse.id;
                    if (!torrentId) throw new Error('Impossibile ottenere l\'ID del torrent da Torbox.');
                } else {
                    torrentId = torrent.id;
                    console.log(`📦 Using existing Torbox torrent. ID: ${torrentId}`);
                }

                for (let i = 0; i < 20; i++) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const torrentInfo = await torbox.getTorrentInfo(torrentId);
                    console.log(`📦 [${i + 1}/20] Torbox ${torrentId}: ${torrentInfo.download_finished ? 'completed' : 'downloading'}`);

                    if (torrentInfo.download_finished === true) {
                        const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                        const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                        
                        const videoFiles = (torrentInfo.files || []).filter(file => {
                            const lowerName = file.name?.toLowerCase() || '';
                            return videoExtensions.some(ext => lowerName.endsWith(ext)) &&
                                   !junkKeywords.some(junk => lowerName.includes(junk));
                        });
                        
                        const bestFile = videoFiles.length > 0
                            ? videoFiles.reduce((max, file) => (file.size > max.size ? file : max), videoFiles[0])
                            : (torrentInfo.files || [])[0];

                        if (!bestFile) throw new Error('Nessun file valido trovato nel torrent.');
                        
                        const downloadData = await torbox.createDownload(torrentId, bestFile.id);
                        console.log(`📦 🚀 Redirecting to Torbox stream`);
                        return res.redirect(302, downloadData);
                    }
                }

                return res.status(200).send(htmlResponse(
                    'Download in Corso',
                    'Il torrent è stato aggiunto a Torbox ed è in download. Torna tra qualche minuto.',
                    false
                ));

            } catch (error) {
                console.error('📦 ❌ Torbox add error:', error);
                return res.status(500).send(htmlResponse('Errore Torbox', error.message, true));
            }
        }

        if (url.pathname.startsWith('/torbox-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            const workerOrigin = url.origin; // For placeholder video URLs
            
            const htmlResponse = (title, message, isError = false) => `
                <!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title>
                <style>body{font-family:sans-serif;background-color:#1E1E1E;color:#E0E0E0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;text-align:center;padding:1em;} .container{max-width:90%;padding:2em;background-color:#2A2A2A;border-radius:8px;box-shadow:0 4px 8px rgba(0,0,0,0.3);} h1{color:${isError ? '#FF6B6B' : '#4EC9B0'};}</style>
                </head><body><div class="container"><h1>${title}</h1><p>${message}</p></div></body></html>`;
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(htmlResponse('Errore Config', e.message, true));
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send(htmlResponse('Errore', 'Torbox API key non configurata.', true));
            }

            if (!encodedMagnet) {
                return res.status(400).send(htmlResponse('Errore', 'Link magnet mancante.', true));
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Magnet link non valido o senza info hash.');

                const torbox = new Torbox(userConfig.torbox_key);
                
                console.log(`[Torbox] Resolving ${infoHash}`);
                
                // STEP 1: Try to find existing torrent (like Torrentio _findTorrent)
                let torrent = null;
                try {
                    const torrents = await torbox.getTorrents();
                    const foundTorrents = torrents.filter(t => t.hash?.toLowerCase() === infoHash.toLowerCase());
                    const nonFailedTorrent = foundTorrents.find(t => t.active || t.download_finished);
                    torrent = nonFailedTorrent || foundTorrents[0];
                    if (torrent) {
                        console.log(`[Torbox] Found existing torrent ID: ${torrent.id}`);
                    }
                } catch (error) {
                    console.log(`[Torbox] No existing torrent found: ${error.message}`);
                }
                
                // STEP 1.5: If not found in user torrents, check if it's in GLOBAL cache
                // This is CRITICAL: if cached, add it instantly without downloading!
                if (!torrent) {
                    console.log(`[Torbox] Checking global cache for ${infoHash}`);
                    try {
                        const cacheCheck = await torbox.checkCache([infoHash]);
                        const cacheInfo = cacheCheck[infoHash.toLowerCase()];
                        
                        // cacheInfo.cached is now always true if returned by checkCache
                        if (cacheInfo && cacheInfo.cached) {
                            console.log(`[Torbox] ⚡ Found in GLOBAL cache! Adding instantly...`);
                            // Torrent is in global cache, adding will be instant
                            // Continue to STEP 2 to add it
                        } else {
                            console.log(`[Torbox] ⚠️ NOT in cache, will need to download`);
                            // Not in cache, show downloading placeholder immediately
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                        }
                    } catch (cacheError) {
                        console.log(`[Torbox] Cache check failed: ${cacheError.message}, will try to add anyway`);
                        // If cache check fails, be optimistic and try to add
                    }
                }
                
                // STEP 2: If not found, create new torrent (like Torrentio _createTorrent)
                if (!torrent) {
                    console.log(`[Torbox] Creating new torrent`);
                    
                    try {
                        const addResponse = await torbox.addTorrent(magnetLink);
                        
                        // Handle different response types from Torbox (like Torrentio does)
                        if (addResponse.torrent_id) {
                            // Torrent created, try to get info
                            const torrentId = addResponse.torrent_id;
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            
                            try {
                                torrent = await torbox.getTorrentInfo(torrentId);
                            } catch (getTorrentError) {
                                // Torrent not yet in list, show downloading placeholder
                                console.log(`[Torbox] Torrent ${torrentId} not yet in list, showing downloading...`);
                                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                            }
                        } else if (addResponse.queued_id) {
                            // Torrent is queued (like Torrentio: download_state === 'metaDL')
                            console.log(`[Torbox] Torrent queued with ID: ${addResponse.queued_id}`);
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                        } else {
                            throw new Error(`Unexpected Torbox response: ${JSON.stringify(addResponse)}`);
                        }
                        
                    } catch (addError) {
                        // If we get 400, it might mean:
                        // 1. Torrent is not in cache and Torbox can't/won't download it
                        // 2. Invalid magnet link
                        // 3. Torbox limitation
                        
                        console.log(`[Torbox] Failed to add torrent: ${addError.message}`);
                        
                        // Check if it's a "not cached" error vs other errors
                        if (addError.message.includes('400')) {
                            // Torrent not available in Torbox cache
                            // Show placeholder indicating it's being added to download queue
                            console.log(`[Torbox] Torrent not cached, starting download...`);
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                        }
                        
                        // For other errors, re-throw
                        throw addError;
                    }
                }
                
                // STEP 3: Check torrent status (EXACT Torrentio logic)
                const statusReady = torrent?.download_present;
                const statusError = (!torrent?.active && !torrent?.download_finished) || torrent?.download_state === 'error';
                const statusDownloading = (!statusReady && !statusError) || !!torrent?.queued_id;
                
                if (statusReady) {
                    // ✅ READY: Unrestrict and stream
                    console.log(`[Torbox] Torrent ready, unrestricting...`);
                    
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                    
                    const videos = (torrent.files || [])
                        .filter(file => {
                            const lowerName = file.name?.toLowerCase() || '';
                            return videoExtensions.some(ext => lowerName.endsWith(ext));
                        })
                        .filter(file => {
                            const lowerName = file.name?.toLowerCase() || '';
                            return !junkKeywords.some(junk => lowerName.includes(junk)) || file.size > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => b.size - a.size);
                    
                    const targetVideo = videos[0];
                    
                    if (!targetVideo) {
                        if (torrent.files.every(file => file.name?.endsWith('.rar') || file.name?.endsWith('.zip'))) {
                            console.log(`[Torbox] Failed: RAR archive`);
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                        }
                        throw new Error('No video file found');
                    }
                    
                    const downloadUrl = await torbox.createDownload(torrent.id, targetVideo.id);
                    
                    console.log(`[Torbox] Redirecting to stream (direct, no MediaFlow)`);
                    return res.redirect(302, downloadUrl);
                    
                } else if (statusDownloading) {
                    // ⏳ DOWNLOADING: Show placeholder video
                    console.log(`[Torbox] Torrent is downloading...`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                    
                } else if (statusError) {
                    // ❌ ERROR: Show failed video
                    console.log(`[Torbox] Torrent failed`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
                // Fallback: something went wrong
                console.log(`[Torbox] Unknown state, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);

            } catch (error) {
                console.error('📦 ❌ Torbox stream error:', error);
                
                // Handle specific errors with placeholder videos (like Torrentio)
                const errorMsg = error.message?.toLowerCase() || '';
                
                if (errorMsg.includes('400') || errorMsg.includes('not found') || errorMsg.includes('invalid')) {
                    // Torrent not available or invalid
                    console.log(`[Torbox] Torrent not available (400/404)`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
                if (errorMsg.includes('rar') || errorMsg.includes('zip')) {
                    // Archive format not supported
                    console.log(`[Torbox] Archive format not supported`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                }
                
                // Generic error: show failed placeholder
                console.log(`[Torbox] Generic error, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }
        }

        // ✅ UNIFIED AllDebrid Stream Endpoint
        if (url.pathname.startsWith('/ad-stream/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const encodedMagnet = pathParts[3];
            
            let userConfig = {};
            try {
                if (!encodedConfigStr) throw new Error("Configurazione mancante nell'URL.");
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                console.error(`[AllDebrid] Config error: ${e.message}`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }

            if (!userConfig.alldebrid_key) {
                console.error(`[AllDebrid] API key not configured`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_access_v2.mp4`);
            }

            if (!encodedMagnet) {
                console.error(`[AllDebrid] Invalid magnet link`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }

            try {
                const magnetLink = decodeURIComponent(encodedMagnet);
                const infoHash = extractInfoHash(magnetLink);
                if (!infoHash) throw new Error('Invalid magnet link or missing info hash.');

                const alldebrid = new AllDebrid(userConfig.alldebrid_key);
                
                console.log(`[AllDebrid] Resolving ${infoHash}`);
                
                // STEP 1: Upload magnet (AllDebrid will use cache if available)
                console.log(`[AllDebrid] Uploading magnet (will use cache if available)`);
                const uploadResponse = await alldebrid.uploadMagnet(magnetLink);
                const magnetId = uploadResponse.id;
                
                if (!magnetId) {
                    throw new Error('Failed to get magnet ID from AllDebrid');
                }
                
                // STEP 2: Get magnet status
                console.log(`[AllDebrid] Checking magnet status: ${magnetId}`);
                const magnetStatus = await alldebrid.getMagnetStatus(magnetId);
                
                // Extract status from response
                const status = magnetStatus.status || magnetStatus.statusCode;
                
                // STEP 3: Check if ready
                if (status === 'Ready' || status === 4) {
                    // ✅ READY: Get files and unrestrict
                    console.log(`[AllDebrid] Magnet ready, getting files...`);
                    
                    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
                    const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                    
                    // Extract files from magnetStatus
                    const files = magnetStatus.links || [];
                    
                    if (files.length === 0) {
                        console.log(`[AllDebrid] No files found`);
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    
                    // Find video files
                    const videos = files
                        .filter(file => {
                            const filename = file.filename || file.link || '';
                            return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
                        })
                        .filter(file => {
                            const filename = file.filename || file.link || '';
                            const lowerName = filename.toLowerCase();
                            const size = file.size || 0;
                            return !junkKeywords.some(junk => lowerName.includes(junk)) || size > 250 * 1024 * 1024;
                        })
                        .sort((a, b) => (b.size || 0) - (a.size || 0));
                    
                    const targetFile = videos[0];
                    
                    if (!targetFile) {
                        console.log(`[AllDebrid] No video file found`);
                        // Check if it's a RAR archive
                        if (files.some(f => (f.filename || '').endsWith('.rar') || (f.filename || '').endsWith('.zip'))) {
                            console.log(`[AllDebrid] Failed: RAR archive`);
                            return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                        }
                        return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                    }
                    
                    // STEP 4: Unlock the link
                    const fileLink = targetFile.link;
                    console.log(`[AllDebrid] Unlocking link for: ${targetFile.filename}`);
                    const unrestrictedUrl = await alldebrid.unlockLink(fileLink);
                    
                    console.log(`[AllDebrid] Redirecting to stream (direct, no MediaFlow)`);
                    return res.redirect(302, unrestrictedUrl);
                    
                } else if (status === 'Downloading' || status === 1 || status === 'Processing' || status === 2) {
                    // ⏳ DOWNLOADING/PROCESSING: Show placeholder video
                    console.log(`[AllDebrid] Magnet is downloading/processing (status: ${status})...`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/downloading_v2.mp4`);
                    
                } else {
                    // ❌ ERROR or UNKNOWN: Show failed video
                    console.log(`[AllDebrid] Unexpected status: ${status}`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
            } catch (error) {
                console.error('🅰️ ❌ AllDebrid stream error:', error);
                
                // Handle specific errors with placeholder videos
                const errorMsg = error.message?.toLowerCase() || '';
                
                if (errorMsg.includes('400') || errorMsg.includes('not found') || errorMsg.includes('invalid')) {
                    console.log(`[AllDebrid] Torrent not available (400/404)`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
                }
                
                if (errorMsg.includes('rar') || errorMsg.includes('zip')) {
                    console.log(`[AllDebrid] Archive format not supported`);
                    return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/failed_rar_v2.mp4`);
                }
                
                // Generic error: show failed placeholder
                console.log(`[AllDebrid] Generic error, showing failed video`);
                return res.redirect(302, `${TORRENTIO_VIDEO_BASE}/videos/download_failed_v2.mp4`);
            }
        }

        if (url.pathname.startsWith('/torbox-stream-personal/')) {
            const pathParts = url.pathname.split('/');
            const encodedConfigStr = pathParts[2];
            const torrentId = pathParts[3];
            
            let userConfig = {};
            res.setHeader('Content-Type', 'text/html');
            try {
                userConfig = JSON.parse(atob(encodedConfigStr));
            } catch (e) {
                return res.status(400).send(`<h1>Errore Config</h1><p>${e.message}</p>`);
            }

            if (!userConfig.torbox_key) {
                return res.status(400).send('<h1>Errore</h1><p>Torbox API key non configurata.</p>');
            }

            try {
                const torbox = new Torbox(userConfig.torbox_key);
                const torrentInfo = await torbox.getTorrentInfo(torrentId);

                if (!torrentInfo.download_finished) {
                    throw new Error('Il torrent non è ancora completato.');
                }

                const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv'];
                const junkKeywords = ['sample', 'trailer', 'extra', 'bonus', 'extras'];
                
                const videoFiles = (torrentInfo.files || []).filter(file => {
                    const lowerName = file.name?.toLowerCase() || '';
                    return videoExtensions.some(ext => lowerName.endsWith(ext)) &&
                           !junkKeywords.some(junk => lowerName.includes(junk));
                });
                
                const bestFile = videoFiles.length > 0
                    ? videoFiles.reduce((max, file) => (file.size > max.size ? file : max), videoFiles[0])
                    : (torrentInfo.files || [])[0];

                if (!bestFile) throw new Error('Nessun file valido trovato.');
                
                const downloadData = await torbox.createDownload(torrentId, bestFile.id);
                console.log(`📦 🚀 Redirecting to personal Torbox stream`);
                return res.redirect(302, downloadData);

            } catch (error) {
                console.error('📦 ❌ Torbox personal stream error:', error);
                return res.status(500).send(`<h1>Errore</h1><p>${error.message}</p>`);
            }
        }

        // Health check
        if (url.pathname === '/health') {
            const health = {
                status: 'OK',
                addon: 'IlCorsaroViola',
                version: '1.0.0',
                uptime: Date.now(),
                cache: {
                    entries: cache.size,
                    maxEntries: MAX_CACHE_ENTRIES,
                    ttl: `${CACHE_TTL / 60000} minutes`
                }
            };

            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(health, null, 2));
        }

        // Enhanced search endpoint for testing
        if (url.pathname === '/search') {
            const query = url.searchParams.get('q');
            const type = url.searchParams.get('type') || 'movie';

            if (!query) {
                res.setHeader('Content-Type', 'application/json');
                return res.status(400).send(JSON.stringify({ error: 'Missing query parameter (q)' }));
            }

            const searchConfig = {
                tmdb_key: env.TMDB_KEY,
                rd_key: env.RD_KEY,
                jackett_url: env.JACKETT_URL,
                jackett_api_key: env.JACKETT_API_KEY,
                jackett_password: env.JACKETT_PASSWORD
            };

            const result = await handleSearch({ query, type }, searchConfig);
            const responseTime = Date.now() - startTime;
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('X-Response-Time', `${responseTime}ms`);
            return res.status(200).send(JSON.stringify({ ...result, responseTimeMs: responseTime }, null, 2));
        }

        // 404 for unknown paths
        res.setHeader('Content-Type', 'application/json');
        return res.status(404).send(JSON.stringify({ error: 'Not Found' }));

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error(`❌ Worker error after ${responseTime}ms:`, error);
        
        res.setHeader('Content-Type', 'application/json');
        return res.status(500).send(JSON.stringify({ 
            error: 'Internal Server Error',
            message: error.message,
            path: url.pathname,
            responseTimeMs: responseTime
        }));
    }
}
