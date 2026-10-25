const fs = require('fs');
const path = require('path');

module.exports = function(eleventyConfig) {
    const dbPath = path.join(__dirname, 'database');
    const creditsPath = path.join(dbPath, 'assets/credits.json');
    const referencesPath = path.join(dbPath, 'assets/references.json');
    eleventyConfig.addWatchTarget("./database/**/*.json");
    
    function loadCreditsData() {
        return JSON.parse(fs.readFileSync(creditsPath, 'utf-8'));
    }
    
    eleventyConfig.addGlobalData("creditsData", loadCreditsData);
    eleventyConfig.addGlobalData("referencesData", function() {
        const referencesData = JSON.parse(fs.readFileSync(referencesPath, 'utf-8'));
        if (!Array.isArray(referencesData.references)) {
            throw new TypeError('database/assets/references.json must contain a "references" array.');
        }
        return referencesData.references.filter(reference => reference.title && reference.url);
    });
    
    eleventyConfig.addGlobalData("textureCatalog", function() {
        const catalogPath = path.join(dbPath, 'assets/textures.json');
        if (fs.existsSync(catalogPath)) {
            return JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
        }
        return {};
    });
    
    // --- Dicionário mapeando cada Textura para sua respectiva Biblioteca ---
    const textureToLibrary = new Map();
    const libDir = path.join(dbPath, 'library');
    
    if (fs.existsSync(libDir)) {
        const packages = fs.readdirSync(libDir);
        for (const pkg of packages) {
            const pkgDir = path.join(libDir, pkg);
            if (!fs.statSync(pkgDir).isDirectory()) continue;
            
            // NOVO: Define o caminho da pasta assets dentro do pacote
            const assetsDir = path.join(pkgDir, 'data');
            
            // Verifica se a pasta assets existe antes de tentar ler
            if (fs.existsSync(assetsDir)) {
                // Lê todas as fotos de dentro da pasta assets
                const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const data = JSON.parse(fs.readFileSync(path.join(assetsDir, file), 'utf-8'));
                    if (data.derived_textures) {
                        data.derived_textures.forEach(texture => {
                            // Registra: "cstrike/materials/brick/havana.vtf" pertence ao "Disk 7"
                            textureToLibrary.set(texture, pkg); 
                        });
                    }
                }
            }
        }
    }
    // -----------------------------------------------------------------------------
    
    // 1. Coleção: Lista de Jogos
    eleventyConfig.addCollection("gamesList", function() {
        const gamesDir = path.join(dbPath, 'games');
        if (!fs.existsSync(gamesDir)) return [];
        
        return fs.readdirSync(gamesDir).filter(item => {
            return fs.statSync(path.join(gamesDir, item)).isDirectory();
        }).map(gameName => {
            let info = {};
            const infoPath = path.join(gamesDir, gameName, 'info.json');
            if (fs.existsSync(infoPath)) {
                info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
            }
            
            let usedLibraries = new Set();
            let mappedTextureCount = 0;
            let totalTextureCount = 0;
            const texturesDir = path.join(gamesDir, gameName, 'textures');
            if (fs.existsSync(texturesDir)) {
                const files = fs.readdirSync(texturesDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const mapData = JSON.parse(fs.readFileSync(path.join(texturesDir, file), 'utf-8'));
                    if (mapData.textures) {
                        mapData.textures.forEach(t => {
                            totalTextureCount++;
                            if (textureToLibrary.has(t)) {
                                usedLibraries.add(textureToLibrary.get(t));
                                mappedTextureCount++;
                            }
                        });
                    }
                }
            }
            const texturePercentage = totalTextureCount === 0
            ? 0
            : Math.round((mappedTextureCount / totalTextureCount) * 100);
            
            return { 
                game: gameName, 
                info: info,
                usedLibraries: Array.from(usedLibraries).sort(),
               stats: {
                   mapped: mappedTextureCount,
               total: totalTextureCount,
               percentage: texturePercentage
               }
            };
        });
    });
    
    // 2. Coleção: Lista de Mapas
    eleventyConfig.addCollection("mapsList", function() {
        const gamesDir = path.join(dbPath, 'games');
        let allMaps = [];
        if (!fs.existsSync(gamesDir)) return [];
        
        const games = fs.readdirSync(gamesDir);
        for (const game of games) {
            const texturesDir = path.join(gamesDir, game, 'textures');
            if (fs.existsSync(texturesDir)) {
                const files = fs.readdirSync(texturesDir).filter(f => f.endsWith('.json'));
                
                for (const file of files) {
                    const fileContent = fs.readFileSync(path.join(texturesDir, file), 'utf-8');
                    const data = JSON.parse(fileContent);
                    
                    let mappedCount = 0;
                    const totalCount = data.textures ? data.textures.length : 0;
                    
                    if (totalCount > 0) {
                        data.textures.forEach(t => {
                            if (textureToLibrary.has(t)) {
                                mappedCount++;
                            }
                        });
                    }
                    
                    const percentage = totalCount === 0 ? 0 : Math.round((mappedCount / totalCount) * 100);
                    const contributors = loadCreditsData().credits.map(credit => ({
                        name: credit.name,
                        textures: credit.textures.filter(texture => data.textures && data.textures.includes(texture))
                    })).filter(credit => credit.textures.length > 0);
                    
                    allMaps.push({
                        game: game,
                        mapId: file.replace('.json', ''),
                                 mapData: data,
                                 contributors: contributors,
                                 stats: {
                                     total: totalCount,
                                     mapped: mappedCount,
                                     percentage: percentage
                                 }
                    });
                }
            }
        }

        for (const map of allMaps) {
            for (const direction of ['before', 'next']) {
                const targetMapId = map.mapData[direction];
                if (!targetMapId) continue;

                const targetMap = allMaps.find(candidate =>
                    candidate.game === map.game && candidate.mapId === targetMapId
                );
                if (!targetMap) {
                    throw new Error(
                        `Map "${map.game}/${map.mapId}" has an invalid "${direction}" target: "${targetMapId}".`
                    );
                }
                map[`${direction}Map`] = {
                    game: targetMap.game,
                    mapId: targetMap.mapId,
                    title: targetMap.mapData.title
                };
            }
        }

        return allMaps;
    });
    
    // 3. Coleção: Lista de Bibliotecas
    eleventyConfig.addCollection("librariesList", function() {
        let allLibraries = [];
        if (!fs.existsSync(libDir)) return [];
        
        const packages = fs.readdirSync(libDir);
        for (const pkg of packages) {
            const pkgDir = path.join(libDir, pkg);
            if (!fs.statSync(pkgDir).isDirectory()) continue;
            
            // Continua lendo o info.json da raiz do pacote
            let info = {};
            const infoPath = path.join(pkgDir, 'info.json');
            if (fs.existsSync(infoPath)) {
                info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
            }
            
            // NOVO: Lê as imagens a partir da pasta assets
            const assetsDir = path.join(pkgDir, 'data');
            let originImages = [];
            
            if (fs.existsSync(assetsDir)) {
                // Como já está em assets/, não precisamos mais filtrar 'info.json'
                const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.json'));
                
                for (const file of files) {
                    const fileContent = fs.readFileSync(path.join(assetsDir, file), 'utf-8');
                    originImages.push({
                        imageId: file.replace('.json', ''),
                                      imageData: JSON.parse(fileContent)
                    });
                }
            }
            
            allLibraries.push({
                libraryName: pkg,
                info: info,
                images: originImages
            });
        }
        return allLibraries;
    });
    
    eleventyConfig.addPassthroughCopy({"database/assets/img": "img"});
    
    return {
        pathPrefix: process.env.ELEVENTY_PATH_PREFIX || "/",
        dir: {
            input: "src",
            output: "_site",
            includes: "_includes"
        }
    };
};