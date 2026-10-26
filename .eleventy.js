const fs = require('fs');
const path = require('path');
const markdownIt = require('markdown-it');
const md = new markdownIt({ html: true, breaks: true });

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
            
            const assetsDir = path.join(pkgDir, 'data');
            
            if (fs.existsSync(assetsDir)) {
                const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const data = JSON.parse(fs.readFileSync(path.join(assetsDir, file), 'utf-8'));
                    if (data.derived_textures) {
                        data.derived_textures.forEach(texture => {
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
            
            // A VARIÁVEL INFO DEVE ESTAR AQUI
            let info = {};
            const infoPath = path.join(gamesDir, gameName, 'info.json');
            if (fs.existsSync(infoPath)) {
                info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
            }
            
            // Busca de imagens banner e logo
            const exts = ['.png', '.jpg', '.jpeg', '.webp', '.jxl', '.gif'];
            let bannerFile = null;
            let logoFile = null;
            for (const ext of exts) {
                if (!bannerFile && fs.existsSync(path.join(gamesDir, gameName, 'banner' + ext))) {
                    bannerFile = `/database/games/${gameName}/banner${ext}`;
                }
                if (!logoFile && fs.existsSync(path.join(gamesDir, gameName, 'logo' + ext))) {
                    logoFile = `/database/games/${gameName}/logo${ext}`;
                }
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
               banner: bannerFile,
               logo: logoFile,
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
                    
                    // NOVO: Procura por um arquivo .md com o mesmo nome do .json do mapa
                    const mdPath = path.join(texturesDir, file.replace('.json', '.md'));
                    let descriptionHtml = null;
                    if (fs.existsSync(mdPath)) {
                        const mdContent = fs.readFileSync(mdPath, 'utf-8');
                        descriptionHtml = md.render(mdContent);
                    }
                    
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
                                 descriptionHtml: descriptionHtml,
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
            
            const mdPath = path.join(pkgDir, 'description.md');
            let descriptionHtml = null;
            if (fs.existsSync(mdPath)) {
                const mdContent = fs.readFileSync(mdPath, 'utf-8');
                descriptionHtml = md.render(mdContent);
            }
            
            // NOVO: Lógica para encontrar o arquivo cover.* independentemente do formato
            const exts = ['.png', '.jpg', '.jpeg', '.webp', '.jxl', '.gif'];
            let coverFile = null;
            for (const ext of exts) {
                if (fs.existsSync(path.join(pkgDir, 'cover' + ext))) {
                    coverFile = `/database/library/${pkg}/cover${ext}`;
                    break;
                }
            }
            
            const assetsDir = path.join(pkgDir, 'data');
            let originImages = [];
            
            if (fs.existsSync(assetsDir)) {
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
                descriptionHtml: descriptionHtml,
                cover: coverFile, // NOVO: Passa a imagem de capa para o template HTML
                images: originImages
            });
        }
        return allLibraries;
    });
    
    eleventyConfig.addPassthroughCopy({"database/assets/img": "img"});
    
    eleventyConfig.addPassthroughCopy("database/library/**/*.png");
    eleventyConfig.addPassthroughCopy("database/library/**/*.jpg");
    eleventyConfig.addPassthroughCopy("database/library/**/*.jpeg");
    eleventyConfig.addPassthroughCopy("database/library/**/*.webp");
    eleventyConfig.addPassthroughCopy("database/library/**/*.jxl");
    eleventyConfig.addPassthroughCopy("database/library/**/*.gif");

    eleventyConfig.addPassthroughCopy("database/games/**/*.png");
    eleventyConfig.addPassthroughCopy("database/games/**/*.jpg");
    eleventyConfig.addPassthroughCopy("database/games/**/*.jpeg");
    eleventyConfig.addPassthroughCopy("database/games/**/*.webp");
    eleventyConfig.addPassthroughCopy("database/games/**/*.jxl");
    eleventyConfig.addPassthroughCopy("database/games/**/*.gif");
    return {
        pathPrefix: process.env.ELEVENTY_PATH_PREFIX || "/",
        dir: {
            input: "src",
            output: "_site",
            includes: "_includes"
        }
    };
};