const { Pool } = require('pg');

// Database connection pool
let pool = null;

/**
 * Initialize PostgreSQL connection pool
 * @param {Object} config - Database configuration
 * @returns {Pool} PostgreSQL pool instance
 */
function initDatabase(config = {}) {
  if (pool) return pool;

  // ✅ Use environment variables for database connection
  pool = new Pool({
    host: config.host || process.env.DB_HOST,
    port: config.port || process.env.DB_PORT,
    database: config.database || process.env.DB_NAME,
    user: config.user || process.env.DB_USER,
    password: config.password || process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, // Vercel timeout-friendly
  });

  pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL error:', err);
  });

  console.log('✅ PostgreSQL Pool initialized');
  return pool;
}

/**
 * Search torrents by IMDb ID
 * @param {string} imdbId - IMDb ID (e.g., "tt0111161")
 * @param {string} type - Media type: 'movie' or 'series'
 * @returns {Promise<Array>} Array of torrent objects
 */
async function searchByImdbId(imdbId, type = null) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    console.log(`💾 [DB] Searching by IMDb: ${imdbId}${type ? ` (${type})` : ''}`);
    
    let query = `
      SELECT 
        info_hash, 
        provider, 
        title, 
        size, 
        type, 
        seeders, 
        imdb_id, 
        tmdb_id,
        cached_rd,
        last_cached_check,
        file_index,
        file_title
      FROM torrents 
      WHERE imdb_id = $1
    `;
    
    const params = [imdbId];
    
    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }
    
    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';
    
    const result = await pool.query(query, params);
    console.log(`💾 [DB] Found ${result.rows.length} torrents for IMDb ${imdbId}`);
    
    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching by IMDb:`, error.message);
    return [];
  }
}

/**
 * Search torrents by TMDb ID
 * @param {number} tmdbId - TMDb ID (e.g., 550)
 * @param {string} type - Media type: 'movie' or 'series'
 * @returns {Promise<Array>} Array of torrent objects
 */
async function searchByTmdbId(tmdbId, type = null) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    console.log(`💾 [DB] Searching by TMDb: ${tmdbId}${type ? ` (${type})` : ''}`);
    
    let query = `
      SELECT 
        info_hash, 
        provider, 
        title, 
        size, 
        type, 
        seeders, 
        imdb_id, 
        tmdb_id,
        cached_rd,
        last_cached_check,
        file_index,
        file_title
      FROM torrents 
      WHERE tmdb_id = $1
    `;
    
    const params = [tmdbId];
    
    if (type) {
      query += ' AND type = $2';
      params.push(type);
    }
    
    query += ' ORDER BY cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';
    
    const result = await pool.query(query, params);
    console.log(`💾 [DB] Found ${result.rows.length} torrents for TMDb ${tmdbId}`);
    
    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching by TMDb:`, error.message);
    return [];
  }
}

/**
 * Search episode files by IMDb ID, season, and episode
 * @param {string} imdbId - IMDb ID of the series
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Promise<Array>} Array of file objects with torrent info
 */
async function searchEpisodeFiles(imdbId, season, episode) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    console.log(`💾 [DB] Searching episode: ${imdbId} S${season}E${episode}`);
    
    const query = `
      SELECT 
        f.file_index,
        f.title as file_title,
        f.size as file_size,
        t.info_hash,
        t.provider,
        t.title as torrent_title,
        t.size as torrent_size,
        t.seeders,
        t.imdb_id,
        t.tmdb_id,
        t.cached_rd,
        t.last_cached_check
      FROM files f
      JOIN torrents t ON f.info_hash = t.info_hash
      WHERE f.imdb_id = $1 
        AND f.imdb_season = $2 
        AND f.imdb_episode = $3
      ORDER BY t.cached_rd DESC NULLS LAST, t.seeders DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query, [imdbId, season, episode]);
    console.log(`💾 [DB] Found ${result.rows.length} files for S${season}E${episode}`);
    
    return result.rows;
  } catch (error) {
    console.error(`❌ [DB] Error searching episode files:`, error.message);
    return [];
  }
}

/**
 * Insert new torrent into database
 * @param {Object} torrent - Torrent data
 * @returns {Promise<boolean>} Success status
 */
async function insertTorrent(torrent) {
  if (!pool) throw new Error('Database not initialized');
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if torrent exists
    const checkResult = await client.query(
      'SELECT info_hash FROM torrents WHERE info_hash = $1',
      [torrent.infoHash]
    );
    
    if (checkResult.rows.length > 0) {
      console.log(`💾 [DB] Torrent ${torrent.infoHash} already exists, skipping`);
      await client.query('ROLLBACK');
      return false;
    }
    
    // Insert torrent
    await client.query(
      `INSERT INTO torrents (
        info_hash, provider, title, size, type, 
        upload_date, seeders, imdb_id, tmdb_id
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
      [
        torrent.infoHash,
        torrent.provider || 'ilcorsaronero',
        torrent.title,
        torrent.size || null,
        torrent.type,
        torrent.seeders || 0,
        torrent.imdbId || null,
        torrent.tmdbId || null
      ]
    );
    
    await client.query('COMMIT');
    console.log(`✅ [DB] Inserted torrent: ${torrent.title.substring(0, 60)}...`);
    return true;
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ [DB] Error inserting torrent:`, error.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * Update RD cache status for multiple hashes
 * @param {Array} cacheResults - Array of {hash, cached} objects
 * @returns {Promise<number>} Number of updated records
 */
async function updateRdCacheStatus(cacheResults) {
  if (!pool) throw new Error('Database not initialized');
  if (!cacheResults || cacheResults.length === 0) return 0;
  
  try {
    let updated = 0;
    
    for (const result of cacheResults) {
      if (!result.hash) continue;
      
      const query = `
        UPDATE torrents 
        SET cached_rd = $1, last_cached_check = NOW()
        WHERE info_hash = $2
      `;
      
      const res = await pool.query(query, [result.cached, result.hash.toLowerCase()]);
      updated += res.rowCount;
    }
    
    console.log(`✅ [DB] Updated RD cache status for ${updated} torrents`);
    return updated;
    
  } catch (error) {
    console.error(`❌ [DB] Error updating RD cache:`, error.message);
    return 0;
  }
}

/**
 * Get cached RD availability for hashes (within 5 days)
 * @param {Array} hashes - Array of info hashes
 * @returns {Promise<Object>} Map of hash -> {cached: boolean, lastCheck: Date}
 */
async function getRdCachedAvailability(hashes) {
  if (!pool) throw new Error('Database not initialized');
  if (!hashes || hashes.length === 0) return {};
  
  try {
    const lowerHashes = hashes.map(h => h.toLowerCase());
    
    // Get cached results that are less than 5 days old
    const query = `
      SELECT info_hash, cached_rd, last_cached_check
      FROM torrents
      WHERE info_hash = ANY($1)
        AND cached_rd IS NOT NULL
        AND last_cached_check IS NOT NULL
        AND last_cached_check > NOW() - INTERVAL '5 days'
    `;
    
    const result = await pool.query(query, [lowerHashes]);
    
    const cachedMap = {};
    result.rows.forEach(row => {
      cachedMap[row.info_hash] = {
        cached: row.cached_rd,
        lastCheck: row.last_cached_check,
        fromCache: true
      };
    });
    
    console.log(`💾 [DB] Found ${result.rows.length}/${hashes.length} hashes with valid RD cache (< 5 days)`);
    
    return cachedMap;
    
  } catch (error) {
    console.error(`❌ [DB] Error getting RD cached availability:`, error.message);
    return {};
  }
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('✅ PostgreSQL Pool closed');
  }
}

/**
 * Batch insert torrents into DB (skip duplicates)
 * @param {Array} torrents - Array of torrent objects
 * @returns {Promise<number>} Number of inserted torrents
 */
async function batchInsertTorrents(torrents) {
  if (!pool) throw new Error('Database not initialized');
  if (!torrents || torrents.length === 0) return 0;
  
  try {
    let inserted = 0;
    
    for (const torrent of torrents) {
      try {
        const query = `
          INSERT INTO torrents (
            info_hash, provider, title, size, type, upload_date, 
            seeders, imdb_id, tmdb_id, cached_rd, last_cached_check, file_index
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (info_hash) DO UPDATE SET
            imdb_id = COALESCE(EXCLUDED.imdb_id, torrents.imdb_id),
            tmdb_id = COALESCE(EXCLUDED.tmdb_id, torrents.tmdb_id),
            seeders = GREATEST(EXCLUDED.seeders, torrents.seeders),
            cached_rd = COALESCE(EXCLUDED.cached_rd, torrents.cached_rd),
            last_cached_check = CASE 
              WHEN EXCLUDED.last_cached_check IS NOT NULL 
              THEN GREATEST(EXCLUDED.last_cached_check, COALESCE(torrents.last_cached_check, EXCLUDED.last_cached_check))
              ELSE torrents.last_cached_check
            END,
            file_index = COALESCE(EXCLUDED.file_index, torrents.file_index)
        `;
        
        const values = [
          torrent.info_hash,
          torrent.provider,
          torrent.title,
          torrent.size,
          torrent.type,
          torrent.upload_date,
          torrent.seeders,
          torrent.imdb_id,
          torrent.tmdb_id,
          torrent.cached_rd,
          torrent.last_cached_check,
          torrent.file_index
        ];
        
        const res = await pool.query(query, values);
        if (res.rowCount > 0) inserted++;
        
      } catch (error) {
        // Skip duplicates silently
        if (!error.message.includes('duplicate key')) {
          console.warn(`⚠️ [DB] Failed to insert torrent ${torrent.info_hash}:`, error.message);
        }
      }
    }
    
    console.log(`✅ [DB] Batch insert: ${inserted}/${torrents.length} new torrents added`);
    return inserted;
    
  } catch (error) {
    console.error(`❌ [DB] Batch insert error:`, error.message);
    return 0;
  }
}

/**
 * Update torrent file info (file_index and file_title) after playing
 * @param {string} infoHash - Torrent info hash
 * @param {number} fileIndex - RealDebrid file.id (1-based)
 * @param {string} filePath - Full file path (will extract filename)
 * @param {Object} episodeInfo - Optional: {imdbId, season, episode} for series
 * @returns {Promise<boolean>} Success status
 */
async function updateTorrentFileInfo(infoHash, fileIndex, filePath, episodeInfo = null) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    console.log(`💾 [DB updateTorrentFileInfo] Input: hash=${infoHash}, fileIndex=${fileIndex}, filePath=${filePath}, episodeInfo=`, episodeInfo);
    
    // Extract just the filename from path
    const fileName = filePath.split('/').pop().split('\\').pop();
    console.log(`💾 [DB updateTorrentFileInfo] Extracted filename: ${fileName}`);
    
    // If episodeInfo is provided, save to 'files' table (for series episodes)
    if (episodeInfo && episodeInfo.imdbId && episodeInfo.season && episodeInfo.episode) {
      console.log(`💾 [DB] Saving episode file: ${episodeInfo.imdbId} S${episodeInfo.season}E${episodeInfo.episode}`);
      
      // Check if file already exists
      const checkQuery = `
        SELECT file_index FROM files 
        WHERE info_hash = $1 
          AND imdb_id = $2 
          AND imdb_season = $3 
          AND imdb_episode = $4
      `;
      const checkRes = await pool.query(checkQuery, [
        infoHash.toLowerCase(),
        episodeInfo.imdbId,
        episodeInfo.season,
        episodeInfo.episode
      ]);
      
      if (checkRes.rowCount > 0) {
        // Record already exists for this episode - just update the title if needed
        const updateQuery = `
          UPDATE files
          SET file_index = $1,
              title = $2
          WHERE info_hash = $3 
            AND imdb_id = $4 
            AND imdb_season = $5 
            AND imdb_episode = $6
        `;
        const res = await pool.query(updateQuery, [
          fileIndex,
          fileName,
          infoHash.toLowerCase(),
          episodeInfo.imdbId,
          episodeInfo.season,
          episodeInfo.episode
        ]);
        console.log(`✅ [DB] Updated file in 'files' table: ${fileName} (rowCount=${res.rowCount})`);
        return res.rowCount > 0;
      } else {
        // Check if this (hash, fileIndex) combo exists for a DIFFERENT episode
        const conflictCheck = await pool.query(
          'SELECT imdb_season, imdb_episode FROM files WHERE info_hash = $1 AND file_index = $2',
          [infoHash.toLowerCase(), fileIndex]
        );
        
        if (conflictCheck.rowCount > 0) {
          // This fileIndex is already used for a different episode - skip to avoid conflict
          const existing = conflictCheck.rows[0];
          console.log(`⚠️ [DB] FileIndex ${fileIndex} already used for S${existing.imdb_season}E${existing.imdb_episode}, skipping S${episodeInfo.season}E${episodeInfo.episode}`);
          return false;
        }
        
        // Insert new file
        const insertQuery = `
          INSERT INTO files (info_hash, file_index, title, imdb_id, imdb_season, imdb_episode)
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const res = await pool.query(insertQuery, [
          infoHash.toLowerCase(),
          fileIndex,
          fileName,
          episodeInfo.imdbId,
          episodeInfo.season,
          episodeInfo.episode
        ]);
        console.log(`✅ [DB] Inserted file into 'files' table: ${fileName} (rowCount=${res.rowCount})`);
        return res.rowCount > 0;
      }
    } else {
      // Fallback: update torrents table (for movies or when episode info not available)
      const query = `
        UPDATE torrents
        SET file_index = $1,
            file_title = $2
        WHERE info_hash = $3
      `;
      
      const res = await pool.query(query, [fileIndex, fileName, infoHash.toLowerCase()]);
      console.log(`✅ [DB] Updated torrents table: ${fileName} (rowCount=${res.rowCount})`);
      
      return res.rowCount > 0;
    }
    
  } catch (error) {
    console.error(`❌ [DB] Error updating file info:`, error.message, error);
    return false;
  }
}

/**
 * Delete all file entries for a specific torrent hash
 * Used when re-adding a torrent to clean up old file selections
 */
async function deleteFileInfo(infoHash) {
  try {
    const query = `DELETE FROM files WHERE info_hash = $1`;
    const res = await pool.query(query, [infoHash.toLowerCase()]);
    console.log(`✅ [DB] Deleted ${res.rowCount} file entries for hash ${infoHash}`);
    return res.rowCount;
  } catch (error) {
    console.error(`❌ [DB] Error deleting file info:`, error.message);
    return 0;
  }
}

/**
 * Get IMDb ID for a torrent by its info hash
 * @param {string} infoHash - Torrent info hash
 * @returns {Promise<string|null>} IMDb ID or null if not found
 */
async function getImdbIdByHash(infoHash) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    const query = 'SELECT imdb_id FROM torrents WHERE info_hash = $1 LIMIT 1';
    const result = await pool.query(query, [infoHash.toLowerCase()]);
    
    if (result.rows.length > 0 && result.rows[0].imdb_id) {
      console.log(`✅ [DB] Found imdb_id ${result.rows[0].imdb_id} for hash ${infoHash}`);
      return result.rows[0].imdb_id;
    }
    
    console.log(`⚠️ [DB] No imdb_id found for hash ${infoHash}`);
    return null;
  } catch (error) {
    console.error(`❌ [DB] Error fetching imdb_id:`, error.message);
    return null;
  }
}

/**
 * Search torrents by title using PostgreSQL Full-Text Search (FTS)
 * This is a fallback when ID-based search returns no results
 * @param {string} cleanedTitle - Cleaned title for search (from cleanTitleForSearch)
 * @param {string} type - Media type: 'movie' or 'series'
 * @param {number} year - Optional year for filtering (±1 tolerance)
 * @returns {Promise<Array>} Array of torrent objects ordered by relevance
 */
async function searchByTitleFTS(cleanedTitle, type = null, year = null) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    console.log(`💾 [DB FTS] Searching: "${cleanedTitle}"${type ? ` (${type})` : ''}${year ? ` year=${year}` : ''}`);
    
    let query = `
      SELECT 
        info_hash, 
        provider, 
        title, 
        size, 
        type, 
        seeders, 
        imdb_id, 
        tmdb_id,
        cached_rd,
        last_cached_check,
        file_index,
        file_title,
        ts_rank(title_vector, plainto_tsquery('italian', $1)) as rank
      FROM torrents 
      WHERE title_vector @@ plainto_tsquery('italian', $1)
    `;
    
    const params = [cleanedTitle];
    let paramIndex = 2;
    
    // Filter by type if provided
    if (type) {
      query += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }
    
    // Filter by year with ±1 tolerance if provided
    if (year) {
      query += ` AND (
        title ~* '\\m${year}\\M' OR 
        title ~* '\\m${year-1}\\M' OR 
        title ~* '\\m${year+1}\\M'
      )`;
    }
    
    // Order by relevance (rank) and seeders
    query += ' ORDER BY rank DESC, cached_rd DESC NULLS LAST, seeders DESC LIMIT 50';
    
    const result = await pool.query(query, params);
    console.log(`💾 [DB FTS] Found ${result.rows.length} torrents (rank threshold applied)`);
    
    // Log top 3 results with rank for debugging
    if (result.rows.length > 0) {
      console.log(`💾 [DB FTS] Top 3 results:`);
      result.rows.slice(0, 3).forEach((row, i) => {
        console.log(`   ${i+1}. ${row.title} (rank: ${row.rank.toFixed(4)}, seeders: ${row.seeders})`);
      });
    }
    
    return result.rows;
  } catch (error) {
    console.error(`❌ [DB FTS] Error:`, error.message);
    // If FTS column doesn't exist yet, return empty array (migration not run)
    if (error.message.includes('title_vector')) {
      console.warn(`⚠️ [DB FTS] title_vector column not found. Run migration: migrations/001_add_fts_support.sql`);
    }
    return [];
  }
}

/**
 * Update torrents with completed IDs (auto-repair)
 * @param {string} infoHash - Info hash of torrent to update
 * @param {string|null} imdbId - IMDb ID to set (if missing)
 * @param {number|null} tmdbId - TMDb ID to set (if missing)
 * @returns {Promise<boolean>} Success status
 */
async function updateTorrentsWithIds(infoHash, imdbId, tmdbId) {
  if (!pool) throw new Error('Database not initialized');
  
  try {
    const updates = [];
    const params = [];
    let paramIndex = 1;
    
    // Build SET clause
    if (imdbId) {
      updates.push(`imdb_id = $${paramIndex++}`);
      params.push(imdbId);
    }
    
    if (tmdbId) {
      updates.push(`tmdb_id = $${paramIndex++}`);
      params.push(tmdbId);
    }
    
    if (updates.length === 0) {
      console.log(`💾 [DB] No IDs to update`);
      return 0;
    }
    
    // Build WHERE clause: update all torrents with same TMDb/IMDb
    const conditions = [];
    
    // If we have tmdbId, update all torrents with this tmdbId OR this infoHash
    if (tmdbId) {
      conditions.push(`(tmdb_id = $${paramIndex} OR info_hash = $${paramIndex + 1})`);
      params.push(tmdbId);
      params.push(infoHash);
      paramIndex += 2;
    } else if (imdbId) {
      // If only imdbId, update all torrents with this imdbId OR this infoHash
      conditions.push(`(imdb_id = $${paramIndex} OR info_hash = $${paramIndex + 1})`);
      params.push(imdbId);
      params.push(infoHash);
      paramIndex += 2;
    } else {
      // Fallback: only update single torrent
      conditions.push(`info_hash = $${paramIndex}`);
      params.push(infoHash);
    }
    
    const query = `
      UPDATE torrents 
      SET ${updates.join(', ')}
      WHERE ${conditions.join(' AND ')}
      AND (imdb_id IS NULL OR tmdb_id IS NULL)
    `;
    
    const result = await pool.query(query, params);
    console.log(`💾 [DB] Auto-repaired ${result.rowCount} torrent(s) with completed IDs`);
    return result.rowCount;
  } catch (error) {
    console.error(`❌ [DB] Error updating IDs:`, error.message);
    return 0;
  }
}

module.exports = {
  initDatabase,
  searchByImdbId,
  searchByTmdbId,
  searchEpisodeFiles,
  searchByTitleFTS,
  insertTorrent,
  updateRdCacheStatus,
  getRdCachedAvailability,
  batchInsertTorrents,
  updateTorrentFileInfo,
  deleteFileInfo,
  getImdbIdByHash,
  updateTorrentsWithIds,
  closeDatabase
};
