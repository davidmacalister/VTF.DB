const fs = require('fs');
const path = require('path');

module.exports = function(eleventyConfig) {
    const dbPath = path.join(__dirname, 'database');
    const creditsPath = path.join(dbPath, 'assets/credits.json');
    eleventyConfig.addWatchTarget("./database/**/*.json");

    function loadCreditsData() {
        const creditsData = JSON.parse(fs.readFileSync(creditsPath, 'utf-8'));
        creditsData.references = creditsData.references.filter(reference => reference.title && reference.url);
        return creditsData;
    }

    eleventyConfig.addGlobalData("creditsData", loadCreditsData);
    
    eleventyConfig.addGlobalData("textureCatalog", function() {
        const catalogPath = path.join(dbPath, 'assets/textures.json');
        if (fs.existsSync(catalogPath)) {
            return JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
        }
        return {};
    });
    
    // --- NOVO: Dicionário mapeando cada Textura para sua respectiva Biblioteca ---
    const textureToLibrary = new Map();
    const libDir = path.join(dbPath, 'library');
    
    if (fs.existsSync(libDir)) {
        const packages = fs.readdirSync(libDir);
        for (const pkg of packages) {
            const pkgDir = path.join(libDir, pkg);
            if (!fs.statSync(pkgDir).isDirectory()) continue;
            
            // Lê todas as fotos, ignorando o info.json
            const files = fs.readdirSync(pkgDir).filter(f => f.endsWith('.json') && f !== 'info.json');
            for (const file of files) {
                const data = JSON.parse(fs.readFileSync(path.join(pkgDir, file), 'utf-8'));
                if (data.derived_textures) {
                    data.derived_textures.forEach(texture => {
                        // Registra: "cstrike/materials/brick/havana.vtf" pertence ao "Disk 7"
                        textureToLibrary.set(texture, pkg); 
                    });
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
            
            // --- NOVO: Descobrir quais bibliotecas este jogo usa ---
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
                                // Se a textura é conhecida, adiciona o nome da biblioteca à lista deste jogo
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
                usedLibraries: Array.from(usedLibraries).sort(), // Array ordenado alfabeticamente
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
                            // Usa o Map para checar se a textura existe
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
            
            let info = {};
            const infoPath = path.join(pkgDir, 'info.json');
            if (fs.existsSync(infoPath)) {
                info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
            }
            
            const files = fs.readdirSync(pkgDir).filter(f => f.endsWith('.json') && f !== 'info.json');
            let originImages = [];
            
            for (const file of files) {
                const fileContent = fs.readFileSync(path.join(pkgDir, file), 'utf-8');
                originImages.push({
                    imageId: file.replace('.json', ''),
                                  imageData: JSON.parse(fileContent)
                });
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