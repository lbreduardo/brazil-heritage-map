/* ==========================================
   BRAZILIAN HERITAGE RISK MANAGEMENT MAP
   Main JavaScript File - Enhanced Risk Formula
   ========================================== */

// Show loading indicator
document.getElementById('loadingIndicator').style.display = 'block';

/* ==========================================
   GLOBAL VARIABLES
   ========================================== */

// Map and layers
var map;
var allLayers = {};
var originalStyles = new Map();
var dominantRiskCache = new Map();

// Filter states
var filters = {
    heritage: {
        immovable: true,
        movable: true
    },
    risk: {
        medium: true,
        high: true,
        very_high: true
    },
    riskType: {
        dam: true,
        fire: true,
        natural: true,
        no_risk: true
    },
    layers: {
        heritage: true,
        dam_buffers: true,
        municipal_risk: true,
        municipal_boundaries: true
    }
};

// Data validation and status tracking
var dataStatus = {
    heritage: 0,
    dams: 0,
    municipalities: 0,
    riskAreas: 0
};

// Store uploaded PDFs temporarily
var uploadedPDFs = [];

// Enhanced risk calculation cache
var enhancedRiskCache = new Map();

/* ==========================================
   ENHANCED RISK CALCULATION SYSTEM
   ========================================== */

// Calculate ICM risk factor based on municipal classification
function getICMRiskFactor(feature) {
    var municipality = normalizeText(feature.properties['municipality'] || '');
    var uf = normalizeText(feature.properties['uf'] || '');
    var municipalityKey = municipality + '_' + uf;
    var icmClass = window.icmData && window.icmData[municipalityKey] ? window.icmData[municipalityKey] : null;
    
    // ICM risk multipliers - worse classification = higher risk
    switch(icmClass) {
        case 'A': return 0.1;  // Best infrastructure - lowest risk
        case 'B': return 0.3;  // Good infrastructure - low risk
        case 'C': return 0.6;  // Poor infrastructure - medium risk
        case 'D': return 1.0;  // Worst infrastructure - highest risk
        default: return 0.5;   // Unknown - medium risk
    }
}

// Calculate PDF availability factor
function getPDFAvailabilityFactor(feature) {
    var municipality = normalizeText(feature.properties['municipality'] || '');
    var uf = normalizeText(feature.properties['uf'] || '');
    var riskScore = parseFloat(feature.properties['comprehensive_risk_score']) || 0;
    
    // Check if site has uploaded PDFs with emergency protocols
    var hasEmergencyPDFs = uploadedPDFs.some(function(pdf) {
        var name = pdf.name.toLowerCase();
        return (name.includes('emergency') || name.includes('emergencia') || 
                name.includes('protocol') || name.includes('protocolo') ||
                name.includes(municipality) || name.includes(uf));
    });
    
    // Sites with risk but no emergency documentation get penalty
    if (riskScore > 0 && !hasEmergencyPDFs) {
        return 0.2;  // Documentation gap increases risk
    }
    
    return 0.0;  // No penalty if docs available or no risk
}

// Calculate enhanced comprehensive risk score
function calculateEnhancedRisk(feature) {
    var featureId = feature.properties['identificacao_bem'] || feature.properties['id'] || Math.random();
    
    // Check cache first
    if (enhancedRiskCache.has(featureId)) {
        return enhancedRiskCache.get(featureId);
    }
    
    // Base risk components
    var damRisk = parseFloat(feature.properties['dam_risk_score']) || 0;
    var fireRisk = parseFloat(feature.properties['fire_risk_score']) || 0;
    var naturalRisk = parseFloat(feature.properties['cemaden_risk_score']) || 0;
    
    // Base risk calculation - weighted combination of all risk types
    var baseRisk = (damRisk * 0.4) + (fireRisk * 0.35) + (naturalRisk * 0.25);
    
    // ICM Classification Factor (municipal capacity)
    var icmFactor = getICMRiskFactor(feature);
    
    // PDF Availability Factor (emergency preparedness)
    var pdfFactor = getPDFAvailabilityFactor(feature);
    
    // Enhanced Risk Formula:
    // Final Risk = (Base Risk * 0.6) + (ICM Factor * 0.25) + (PDF Factor * 0.15)
    var enhancedRisk = (baseRisk * 0.6) + (icmFactor * 0.25) + (pdfFactor * 0.15);
    
    // Ensure risk is within reasonable bounds
    enhancedRisk = Math.max(0, Math.min(enhancedRisk, 3.0));
    
    // Cache the result
    enhancedRiskCache.set(featureId, enhancedRisk);
    
    return enhancedRisk;
}

// Get enhanced risk level label
function getEnhancedRiskLevel(enhancedRisk) {
    if (enhancedRisk <= 0.1) return { level: 'Sem Risco', color: '#95a5a6' };
    if (enhancedRisk <= 0.72) return { level: 'Risco Médio', color: '#f1c40f' };
    if (enhancedRisk <= 1.5) return { level: 'Risco Alto', color: '#e67e22' };
    return { level: 'Risco Muito Alto', color: '#e74c3c' };
}

// Clear risk cache when PDFs change
function clearRiskCache() {
    enhancedRiskCache.clear();
    dominantRiskCache.clear();
}

/* ==========================================
   UTILITY FUNCTIONS
   ========================================== */

function normalizeText(text) {
    return text.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_]/g, '')
        .trim();
}

function updateTimestamp() {
    var now = new Date();
    var options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/Sao_Paulo'
    };
    var timestamp = now.toLocaleString('pt-BR', options);
    document.getElementById('lastUpdate').innerHTML = 'Última Atualização: ' + timestamp;
}

function getDominantRiskType(properties) {
    var damRisk = parseFloat(properties['dam_risk_score']) || 0;
    var fireRisk = parseFloat(properties['fire_risk_score']) || 0;
    var naturalRisk = parseFloat(properties['cemaden_risk_score']) || 0;
    
    if (damRisk <= 0.1 && fireRisk <= 0.1 && naturalRisk <= 0.1) {
        return 'no_risk';
    }
    
    var maxRisk = Math.max(damRisk, fireRisk, naturalRisk);
    
    if (maxRisk === damRisk && damRisk > 0) {
        return 'dam';
    } else if (maxRisk === fireRisk && fireRisk > 0) {
        return 'fire';
    } else if (maxRisk === naturalRisk && naturalRisk > 0) {
        return 'natural';
    } else {
        return 'no_risk';
    }
}
// ADD THIS FUNCTION:
function optimizeMunicipalBoundaries() {
    if (!allLayers.heritage || !allLayers.municipal_boundaries) return;
    
    var activeMunicipalities = new Set();
    
    // Collect municipalities with heritage sites
    allLayers.heritage.eachLayer(function(layer) {
        var mun = normalizeText(layer.feature.properties['municipality'] || '');
        var state = normalizeText(layer.feature.properties['uf'] || '');
        activeMunicipalities.add(mun + '_' + state);
    });
    
    // Hide municipalities without heritage
    var hiddenCount = 0;
    allLayers.municipal_boundaries.eachLayer(function(layer) {
        var munName = normalizeText(layer.feature.properties['NM_MUN'] || '');
        var munState = normalizeText(layer.feature.properties['SIGLAUF'] || '');
        var key = munName + '_' + munState;
        
        if (!activeMunicipalities.has(key)) {
            layer.setStyle({ opacity: 0, fillOpacity: 0 });
            layer.options.interactive = false;
            hiddenCount++;
        }
    });
    
    console.log('Performance optimization: hidden', hiddenCount, 'empty municipalities');
}
// Progressive loading system
function loadLayerProgressively(layerName, callback) {
    switch(layerName) {
        case 'heritage':
            if (typeof json_comprehensive_heritage_risk_4 !== 'undefined') {
                setTimeout(callback, 100); // Small delay for UI update
            } else {
                setTimeout(function() { loadLayerProgressively(layerName, callback); }, 100);
            }
            break;
        case 'municipal_risk':
            if (typeof json_municipalities_with_combined_risk_simplified_2 !== 'undefined') {
                setTimeout(callback, 100);
            } else {
                setTimeout(function() { loadLayerProgressively(layerName, callback); }, 100);
            }
            break;
        case 'dam_buffers':
            if (typeof json_snisb_dam_buffers_3 !== 'undefined') {
                setTimeout(callback, 100);
            } else {
                setTimeout(function() { loadLayerProgressively(layerName, callback); }, 100);
            }
            break;
        case 'municipal_boundaries':
            if (typeof json_municipalities_1_simplified_1 !== 'undefined') {
                setTimeout(callback, 100);
            } else {
                setTimeout(function() { loadLayerProgressively(layerName, callback); }, 100);
            }
            break;
    }
}

function updateLoadingProgress(percent, message) {
    var indicator = document.getElementById('loadingIndicator');
    indicator.innerHTML = '<div style="text-align: center;">' +
                         '<div style="font-size: 14px; margin-bottom: 5px;">' + message + '</div>' +
                         '<div style="background: rgba(255,255,255,0.3); height: 4px; border-radius: 2px; overflow: hidden;">' +
                         '<div style="background: #3498db; height: 100%; width: ' + percent + '%; transition: width 0.3s ease;"></div>' +
                         '</div>' +
                         '<div style="font-size: 12px; margin-top: 3px;">' + percent + '%</div>' +
                         '</div>';
}

function initializeProgressiveLoading() {
    updateLoadingProgress(0, 'Iniciando carregamento...');
    
    loadLayerProgressively('heritage', function() {
        updateLoadingProgress(25, 'Carregando sítios de patrimônio...');
        
        loadLayerProgressively('municipal_risk', function() {
            updateLoadingProgress(50, 'Carregando áreas de risco...');
            
            loadLayerProgressively('dam_buffers', function() {
                updateLoadingProgress(75, 'Carregando zonas de barragens...');
                
                loadLayerProgressively('municipal_boundaries', function() {
                    updateLoadingProgress(90, 'Otimizando limites municipais...');
                    
                    setTimeout(function() {
                        checkDataStatus();
                        optimizeMunicipalBoundaries();
                        updateLoadingProgress(100, 'Concluído!');
                        
                        setTimeout(function() {
                            document.getElementById('loadingIndicator').style.display = 'none';
                            applyAllFilters();
                        }, 500);
                    }, 300);
                });
            });
        });
    });
}

/* ==========================================
   PDF UPLOAD FUNCTIONALITY
   ========================================== */

function handlePDFUpload(event) {
    var files = event.target.files;
    
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        
        if (file.type === 'application/pdf') {
            processPDFFile(file);
        } else {
            console.log('Skipped non-PDF file:', file.name);
        }
    }
    
    event.target.value = '';
    clearRiskCache();
    
    setTimeout(function() {
        updateDataStatusWithPDFs();
        if (allLayers.heritage) {
            refreshHeritageLayerStyling();
        }
    }, 100);
}

function processPDFFile(file) {
    var fileReader = new FileReader();
    
    fileReader.onload = function(e) {
        var pdfData = {
            id: Date.now() + Math.random(),
            name: file.name,
            size: file.size,
            uploadDate: new Date(),
            risk: calculatePDFRisk(file.name, file.size),
            data: e.target.result
        };
        
        uploadedPDFs.push(pdfData);
        updatePDFList();
        
        console.log('PDF processed:', file.name, 'Risk:', pdfData.risk);
    };
    
    fileReader.readAsArrayBuffer(file);
}

function calculatePDFRisk(filename, fileSize) {
    var riskScore = 0;
    var name = filename.toLowerCase();
    
    if (name.includes('emergency') || name.includes('emergencia')) riskScore += 30;
    if (name.includes('high') || name.includes('alto')) riskScore += 25;
    if (name.includes('dam') || name.includes('barragem')) riskScore += 20;
    if (name.includes('fire') || name.includes('fogo')) riskScore += 20;
    if (name.includes('risk') || name.includes('risco')) riskScore += 15;
    if (name.includes('critical') || name.includes('critico')) riskScore += 25;
    if (name.includes('danger') || name.includes('perigo')) riskScore += 20;
    if (name.includes('evacuation') || name.includes('evacuacao')) riskScore += 30;
    
    if (fileSize > 5000000) riskScore += 15;
    else if (fileSize > 1000000) riskScore += 10;
    else if (fileSize > 500000) riskScore += 5;
    
    riskScore += Math.floor(Math.random() * 20);
    
    if (riskScore >= 50) return 'high';
    if (riskScore >= 25) return 'medium';
    return 'low';
}

function updatePDFList() {
    var listContainer = document.getElementById('uploadedPDFList');
    var html = '';
    
    if (uploadedPDFs.length === 0) {
        html = '<div class="no-pdfs">Nenhum PDF enviado</div>';
    } else {
        uploadedPDFs.forEach(function(pdf) {
            var riskClass = 'risk-' + pdf.risk;
            var riskText = pdf.risk === 'high' ? 'Alto' : pdf.risk === 'medium' ? 'Médio' : 'Baixo';
            var fileName = pdf.name.length > 25 ? pdf.name.substring(0, 22) + '...' : pdf.name;
            var fileSize = (pdf.size / 1024).toFixed(1) + 'KB';
            
            html += '<div class="uploaded-file">' +
                    '<span style="flex-grow: 1;" title="' + pdf.name + '">' + fileName + '</span>' +
                    '<span style="font-size: 9px; color: #95a5a6;">' + fileSize + '</span>' +
                    '<span class="file-risk ' + riskClass + '">' + riskText + '</span>' +
                    '<button class="remove-file" onclick="removePDF(\'' + pdf.id + '\')">×</button>' +
                    '</div>';
        });
    }
    
    listContainer.innerHTML = html;
}

function removePDF(pdfId) {
    uploadedPDFs = uploadedPDFs.filter(function(pdf) {
        return pdf.id != pdfId;
    });
    updatePDFList();
    clearRiskCache();
    updateDataStatusWithPDFs();
    
    if (allLayers.heritage) {
        refreshHeritageLayerStyling();
    }
}

function getPDFStats() {
    var stats = {
        total: uploadedPDFs.length,
        high: uploadedPDFs.filter(function(p) { return p.risk === 'high'; }).length,
        medium: uploadedPDFs.filter(function(p) { return p.risk === 'medium'; }).length,
        low: uploadedPDFs.filter(function(p) { return p.risk === 'low'; }).length
    };
    return stats;
}

function refreshHeritageLayerStyling() {
    if (!allLayers.heritage) return;
    
    allLayers.heritage.eachLayer(function(layer) {
        var newStyle = getHeritageStyleWithEnhancedRisk(layer.feature);
        layer.setStyle(newStyle);
    });
}

function getHeritageStyleWithEnhancedRisk(feature) {
    var nature = String(feature.properties['ds_natureza'] || '');
    var enhancedRisk = calculateEnhancedRisk(feature);
    var riskInfo = getEnhancedRiskLevel(enhancedRisk);
    
    var baseStyle = {
        radius: 4.0,
        opacity: 1,
        color: 'rgba(255,255,255,0.9)',
        dashArray: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        weight: 2.0,
        fill: true,
        fillOpacity: 0.8,
        fillColor: riskInfo.color,
        interactive: true,
    };
    
    if (nature.includes('Imóvel') || nature.includes('Imovel') || nature.includes('Bem Imóvel')) {
        return Object.assign(baseStyle, { pane: 'pane_comprehensive_heritage_risk_4' });
    } else if (nature.includes('Móvel') || nature.includes('Movel') || nature.includes('Bem Móvel')) {
        return Object.assign(baseStyle, { pane: 'pane_comprehensive_heritage_risk_4', shape: 'diamond' });
    } else {
        return Object.assign(baseStyle, { pane: 'pane_comprehensive_heritage_risk_4', shape: 'triangle' });
    }
}

/* ==========================================
   DATA STATUS FUNCTIONS
   ========================================== */

function updateFilterStats() {
    if (!allLayers.heritage) return;
    
    var total = 0;
    var visible = 0;
    
    allLayers.heritage.eachLayer(function(layer) {
        total++;
        if (layer.options.opacity > 0) {
            visible++;
        }
    });
    
    document.getElementById('totalCount').textContent = total;
    document.getElementById('visibleCount').textContent = visible;
}

function updateDataStatusWithPDFs() {
    var pdfStats = getPDFStats();
    var riskElement = document.getElementById('riskCount');
    
    if (riskElement && pdfStats.total > 0) {
        var originalText = riskElement.innerHTML.split('<br>')[0];
        riskElement.innerHTML = originalText + '<br>PDFs Enviados: ' + pdfStats.total + 
                               ' (Alto: ' + pdfStats.high + ', Médio: ' + pdfStats.medium + ', Baixo: ' + pdfStats.low + ')';
    }
}

function checkDataStatus() {
    if (typeof json_comprehensive_heritage_risk_4 !== 'undefined' && json_comprehensive_heritage_risk_4.features) {
        dataStatus.heritage = json_comprehensive_heritage_risk_4.features.length;
        document.getElementById('heritageCount').innerHTML = 'Sítios de Bens Culturais: ' + dataStatus.heritage;
        document.getElementById('totalCount').textContent = dataStatus.heritage;
    } else {
        document.getElementById('heritageCount').innerHTML = 'Sítios de Bens Culturais: Falha ao carregar';
    }
    
    if (typeof json_snisb_dam_buffers_3 !== 'undefined' && json_snisb_dam_buffers_3.features) {
        dataStatus.dams = json_snisb_dam_buffers_3.features.length;
        document.getElementById('damCount').innerHTML = 'Zonas de Barragens: ' + dataStatus.dams;
    } else {
        document.getElementById('damCount').innerHTML = 'Zonas de Barragens: Falha ao carregar';
    }
    
    if (typeof json_municipalities_1_simplified_1 !== 'undefined' && json_municipalities_1_simplified_1.features) {
        dataStatus.municipalities = json_municipalities_1_simplified_1.features.length;
        document.getElementById('municipalCount').innerHTML = 'Municípios: ' + dataStatus.municipalities;
    } else {
        document.getElementById('municipalCount').innerHTML = 'Municípios: Falha ao carregar';
    }
    
    if (typeof json_municipalities_with_combined_risk_simplified_2 !== 'undefined' && json_municipalities_with_combined_risk_simplified_2.features) {
        dataStatus.riskAreas = json_municipalities_with_combined_risk_simplified_2.features.length;
        document.getElementById('riskCount').innerHTML = 'Áreas de Risco: ' + dataStatus.riskAreas;
    } else {
        document.getElementById('riskCount').innerHTML = 'Áreas de Risco: Falha ao carregar';
    }
    
    updateTimestamp();
    updateDataStatusWithPDFs();
}

/* ==========================================
   FILTER FUNCTIONS
   ========================================== */

function toggleFilterPanel() {
    var panel = document.getElementById('filterPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleHeritageFilter(type) {
    filters.heritage[type] = !filters.heritage[type];
    document.getElementById('heritage_' + type).checked = filters.heritage[type];
    applyAllFilters();
}

function toggleRiskFilter(level) {
    filters.risk[level] = !filters.risk[level];
    document.getElementById('risk_' + level).checked = filters.risk[level];
    applyAllFilters();
}

function toggleRiskTypeFilter(type) {
    filters.riskType[type] = !filters.riskType[type];
    document.getElementById('risk_type_' + type).checked = filters.riskType[type];
    applyAllFilters();
}

function applyAllFilters() {
    if (!allLayers.heritage) return;
    
    allLayers.heritage.eachLayer(function(layer) {
        if (!originalStyles.has(layer._leaflet_id)) {
            originalStyles.set(layer._leaflet_id, {
                opacity: 1,
                fillOpacity: 0.8
            });
        }
        
        if (!dominantRiskCache.has(layer._leaflet_id)) {
            var dominantType = getDominantRiskType(layer.feature.properties);
            dominantRiskCache.set(layer._leaflet_id, dominantType);
        }
        
        var nature = String(layer.feature.properties['ds_natureza'] || '');
        var enhancedRisk = calculateEnhancedRisk(layer.feature);
        var dominantRisk = dominantRiskCache.get(layer._leaflet_id);
        
        var shouldShow = true;
        
        // Heritage Type Filter
        var heritageTypeMatches = false;
        var anyHeritageTypeSelected = filters.heritage.immovable || filters.heritage.movable;
        
        if (anyHeritageTypeSelected) {
            if (filters.heritage.immovable && (nature.includes('Imóvel') || nature.includes('Bem Imóvel'))) {
                heritageTypeMatches = true;
            }
            if (filters.heritage.movable && (nature.includes('Móvel') || nature.includes('Bem Móvel'))) {
                heritageTypeMatches = true;
            }
            
            if (!heritageTypeMatches) {
                shouldShow = false;
            }
        } else {
            shouldShow = false;
        }
        
        // Risk Level Filter - Using enhanced risk
        if (shouldShow) {
            var riskLevelMatches = false;
            var anyRiskLevelSelected = filters.risk.medium || filters.risk.high || filters.risk.very_high;
            
            if (anyRiskLevelSelected) {
                if (filters.risk.medium && enhancedRisk > 0 && enhancedRisk <= 0.72) {
                    riskLevelMatches = true;
                }
                if (filters.risk.high && enhancedRisk > 0.72 && enhancedRisk <= 1.5) {
                    riskLevelMatches = true;
                }
                if (filters.risk.very_high && enhancedRisk > 1.5) {
                    riskLevelMatches = true;
                }
                
                if (enhancedRisk === 0 && filters.risk.medium) {
                    riskLevelMatches = true;
                }
                
                if (!riskLevelMatches) {
                    shouldShow = false;
                }
            } else {
                shouldShow = false;
            }
        }
        
        // Dominant Risk Type Filter
        if (shouldShow) {
            var anyRiskTypeSelected = filters.riskType.dam || filters.riskType.fire || 
                                    filters.riskType.natural || filters.riskType.no_risk;
            
            if (anyRiskTypeSelected) {
                var riskTypeMatches = false;
                
                if (filters.riskType[dominantRisk]) {
                    riskTypeMatches = true;
                }
                
                if (!riskTypeMatches) {
                    shouldShow = false;
                }
            } else {
                shouldShow = false;
            }
        }
        
        // Apply visibility
        if (shouldShow) {
            var originalStyle = originalStyles.get(layer._leaflet_id);
            layer.setStyle({
                opacity: originalStyle.opacity,
                fillOpacity: originalStyle.fillOpacity
            });
            if (layer._path) {
                layer._path.style.pointerEvents = 'auto';
            }
        } else {
            layer.setStyle({
                opacity: 0,
                fillOpacity: 0
            });
            if (layer._path) {
                layer._path.style.pointerEvents = 'none';
            }
        }
    });
    
    updateFilterStats();
}

function toggleLayer(layerName) {
    filters.layers[layerName] = !filters.layers[layerName];
    document.getElementById('layer_' + layerName).checked = filters.layers[layerName];
    
    var layer = allLayers[layerName];
    if (layer) {
        if (filters.layers[layerName]) {
            if (!map.hasLayer(layer)) {
                map.addLayer(layer);
            }
            if (layerName === 'heritage') {
                applyAllFilters();
            }
        } else {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        }
    }
}

function resetAllFilters() {
    for (var category in filters) {
        for (var item in filters[category]) {
            filters[category][item] = false;
            
            var checkboxId;
            if (category === 'heritage') {
                checkboxId = 'heritage_' + item;
            } else if (category === 'risk') {
                checkboxId = 'risk_' + item;
            } else if (category === 'riskType') {
                checkboxId = 'risk_type_' + item;
            } else if (category === 'layers') {
                checkboxId = 'layer_' + item;
            }
            
            var checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = false;
            }
        }
    }
    
    applyAllFilters();
    
    for (var layerName in allLayers) {
        if (allLayers[layerName] && map.hasLayer(allLayers[layerName])) {
            map.removeLayer(allLayers[layerName]);
        }
    }
}

function showAllLayers() {
    for (var category in filters) {
        for (var item in filters[category]) {
            filters[category][item] = true;
            
            var checkboxId;
            if (category === 'heritage') {
                checkboxId = 'heritage_' + item;
            } else if (category === 'risk') {
                checkboxId = 'risk_' + item;
            } else if (category === 'riskType') {
                checkboxId = 'risk_type_' + item;
            } else if (category === 'layers') {
                checkboxId = 'layer_' + item;
            }
            
            var checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = true;
            }
        }
    }
    
    for (var layerName in allLayers) {
        if (allLayers[layerName] && !map.hasLayer(allLayers[layerName])) {
            map.addLayer(allLayers[layerName]);
        }
    }
    
    applyAllFilters();
}

/* ==========================================
   MAP INITIALIZATION
   ========================================== */

var highlightLayer;
function highlightFeature(e) {
    highlightLayer = e.target;
    highlightLayer.openPopup();
}

map = L.map('map', {
    zoomControl: false, 
    maxZoom: 28, 
    minZoom: 1
});

var hash = new L.Hash(map);
map.attributionControl.setPrefix('<a href="https://github.com/tomchadwin/qgis2web" target="_blank">qgis2web</a> &middot; <a href="https://leafletjs.com" title="A JS library for interactive maps">Leaflet</a> &middot; <a href="https://qgis.org">QGIS</a>');
var autolinker = new Autolinker({truncate: {length: 30, location: 'smart'}});

/* ==========================================
   POPUP UTILITY FUNCTIONS
   ========================================== */

function removeEmptyRowsFromPopupContent(content, feature) {
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    var rows = tempDiv.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
        var td = rows[i].querySelector('td.visible-with-data');
        var key = td ? td.id : '';
        if (td && td.classList.contains('visible-with-data') && feature.properties[key] == null) {
            rows[i].parentNode.removeChild(rows[i]);
        }
    }
    return tempDiv.innerHTML;
}

function addClassToPopupIfMedia(content, popup) {
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    if (tempDiv.querySelector('td img')) {
        popup._contentNode.classList.add('media');
        setTimeout(function() {
            popup.update();
        }, 10);
    } else {
        popup._contentNode.classList.remove('media');
    }
}

/* ==========================================
   MAP CONTROLS SETUP
   ========================================== */

var zoomControl = L.control.zoom({
    position: 'topleft'
}).addTo(map);

var measureControl = new L.Control.Measure({
    position: 'topleft',
    primaryLengthUnit: 'meters',
    secondaryLengthUnit: 'kilometers',
    primaryAreaUnit: 'sqmeters',
    secondaryAreaUnit: 'hectares'
});
measureControl.addTo(map);
document.getElementsByClassName('leaflet-control-measure-toggle')[0].innerHTML = '';
document.getElementsByClassName('leaflet-control-measure-toggle')[0].className += ' fas fa-ruler';

var bounds_group = new L.featureGroup([]);
function setBounds() {
    if (bounds_group.getLayers().length) {
        map.fitBounds(bounds_group.getBounds());
    }
}

/* ==========================================
   BASE LAYER SETUP
   ========================================== */

map.createPane('pane_OpenStreetMap_0');
map.getPane('pane_OpenStreetMap_0').style.zIndex = 400;
var layer_OpenStreetMap_0 = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    pane: 'pane_OpenStreetMap_0',
    opacity: 0.35,
    attribution: '',
    minZoom: 1,
    maxZoom: 28,
    minNativeZoom: 0,
    maxNativeZoom: 19
});
layer_OpenStreetMap_0;
map.addLayer(layer_OpenStreetMap_0);

/* ==========================================
   LAYER DEFINITIONS
   ========================================== */

// Municipal boundaries layer
function pop_municipalities_1_simplified_1(feature, layer) {
    layer.on({
        click: highlightFeature,
    });

    var municipality = normalizeText(feature.properties['NM_MUN'] || '');
    var uf = normalizeText(feature.properties['SIGLAUF'] || '');
    var municipalityKey = municipality + '_' + uf;
    var icmClassification = window.icmData && window.icmData[municipalityKey] ? window.icmData[municipalityKey] : null;

    var icmBadge = '';
    if (icmClassification) {
        var icmColor = '';
        switch(icmClassification) {
            case 'A': icmColor = '#2E7D32'; break;
            case 'B': icmColor = '#1976D2'; break;
            case 'C': icmColor = '#F57F17'; break;
            case 'D': icmColor = '#C62828'; break;
            default: icmColor = '#757575';
        }
        icmBadge = '<span style="background-color: ' + icmColor + '; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold;">' + icmClassification + '</span>';
    } else {
        icmBadge = '<span style="background-color: #757575; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">N/A</span>';
    }

    var popupContent = '<table>\
            <tr>\
                <td colspan="2" class="heritage-title"><strong>' + (feature.properties['NM_MUN'] !== null ? autolinker.link(String(feature.properties['NM_MUN']).replace(/'/g, '\'').toLocaleString()) : '') + '</strong></td>\
            </tr>\
            <tr>\
                <th scope="row">Estado</th>\
                <td>' + (feature.properties['SIGLA_UF'] !== null ? autolinker.link(String(feature.properties['SIGLA_UF']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Classificação ICM</th>\
                <td>' + icmBadge + '</td>\
            </tr>\
        </table>';
    var content = removeEmptyRowsFromPopupContent(popupContent, feature);
    layer.on('popupopen', function(e) {
        addClassToPopupIfMedia(content, e.popup);
    });
    layer.bindPopup(content, { maxHeight: 400 });
}

function style_municipalities_1_simplified_1_0() {
    return {
        pane: 'pane_municipalities_1_simplified_1',
        opacity: 1,
        color: 'rgba(140,140,140,0.7)',
        dashArray: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        weight: 1, 
        fill: true,
        fillOpacity: 0.3,
        fillColor: 'rgba(236,242,246,0.3)',
        interactive: true,
    }
}

map.createPane('pane_municipalities_1_simplified_1');
map.getPane('pane_municipalities_1_simplified_1').style.zIndex = 401;
map.getPane('pane_municipalities_1_simplified_1').style['mix-blend-mode'] = 'normal';
var layer_municipalities_1_simplified_1 = new L.geoJson(json_municipalities_1_simplified_1, {
    attribution: '',
    interactive: true,
    dataVar: 'json_municipalities_1_simplified_1',
    layerName: 'layer_municipalities_1_simplified_1',
    pane: 'pane_municipalities_1_simplified_1',
    onEachFeature: pop_municipalities_1_simplified_1,
    style: style_municipalities_1_simplified_1_0,
});
bounds_group.addLayer(layer_municipalities_1_simplified_1);
map.addLayer(layer_municipalities_1_simplified_1);
allLayers.municipal_boundaries = layer_municipalities_1_simplified_1;

// Risk choropleth layer
function pop_municipalities_with_combined_risk_simplified_2(feature, layer) {
    layer.on({
        click: highlightFeature,
    });

    var riskScore = feature.properties['comprehensive_risk_score_mean'];
    var riskLevel = 'Sem Risco';
    var riskColor = '#95a5a6';

    if (riskScore !== null && riskScore > 0) {
        if (riskScore <= 0.72) {
            riskLevel = 'Risco Médio';
            riskColor = '#f1c40f';
        } else if (riskScore <= 1.5) {
            riskLevel = 'Risco Alto';
            riskColor = '#e67e22';
        } else {
            riskLevel = 'Risco Muito Alto';
            riskColor = '#e74c3c';
        }
    }

    var popupContent = '<table>\
            <tr>\
                <td colspan="2" class="heritage-title"><strong>' + (feature.properties['NM_MUN'] !== null ? autolinker.link(String(feature.properties['NM_MUN']).replace(/'/g, '\'').toLocaleString()) : '') + '</strong></td>\
            </tr>\
            <tr>\
                <th scope="row">Estado</th>\
                <td>' + (feature.properties['SIGLA_UF'] !== null ? autolinker.link(String(feature.properties['SIGLA_UF']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Nível de Risco</th>\
                <td class="risk-score" style="background-color: ' + riskColor + ' !important;">' + riskLevel + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Pontuação de Risco</th>\
                <td class="risk-score">' + (riskScore !== null ? riskScore.toFixed(3) : 'N/A') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Pontos de Patrimônio</th>\
                <td>' + (feature.properties['NUMPOINTS'] !== null ? autolinker.link(String(feature.properties['NUMPOINTS']).replace(/'/g, '\'').toLocaleString()) : '0') + '</td>\
            </tr>\
        </table>';
    var content = removeEmptyRowsFromPopupContent(popupContent, feature);
    layer.on('popupopen', function(e) {
        addClassToPopupIfMedia(content, e.popup);
    });
    layer.bindPopup(content, { maxHeight: 400 });
}

function style_municipalities_with_combined_risk_simplified_2_0(feature) {
    var riskScore = feature.properties['comprehensive_risk_score_mean'];

    if (riskScore === null || riskScore === undefined || riskScore <= 0) {
        return {
            pane: 'pane_municipalities_with_combined_risk_simplified_2',
            opacity: 0.5,
            color: 'rgba(149,165,166,0.8)',
            dashArray: '',
            lineCap: 'butt',
            lineJoin: 'miter',
            weight: 1.0,
            fill: true,
            fillOpacity: 0.2,
            fillColor: 'rgba(149,165,166,0.2)',
            interactive: true,
        }
    }

    if (riskScore <= 0.72) {
        return {
            pane: 'pane_municipalities_with_combined_risk_simplified_2',
            opacity: 1,
            color: 'rgba(241,196,15,1.0)',
            dashArray: '',
            lineCap: 'butt',
            lineJoin: 'miter',
            weight: 1.0,
            fill: true,
            fillOpacity: 0.7,
            fillColor: 'rgba(241,196,15,0.7)',
            interactive: true,
        }
    }
    else if (riskScore <= 1.5) {
        return {
            pane: 'pane_municipalities_with_combined_risk_simplified_2',
            opacity: 1,
            color: 'rgba(230,126,34,1.0)',
            dashArray: '',
            lineCap: 'butt',
            lineJoin: 'miter',
            weight: 1.0,
            fill: true,
            fillOpacity: 0.7,
            fillColor: 'rgba(230,126,34,0.7)',
            interactive: true,
        }
    }
    else {
        return {
            pane: 'pane_municipalities_with_combined_risk_simplified_2',
            opacity: 1,
            color: 'rgba(231,76,60,1.0)',
            dashArray: '',
            lineCap: 'butt',
            lineJoin: 'miter',
            weight: 1.0,
            fill: true,
            fillOpacity: 0.8,
            fillColor: 'rgba(231,76,60,0.8)',
            interactive: true,
        }
    }
}

map.createPane('pane_municipalities_with_combined_risk_simplified_2');
map.getPane('pane_municipalities_with_combined_risk_simplified_2').style.zIndex = 402;
map.getPane('pane_municipalities_with_combined_risk_simplified_2').style['mix-blend-mode'] = 'normal';
var layer_municipalities_with_combined_risk_simplified_2 = new L.geoJson(json_municipalities_with_combined_risk_simplified_2, {
    attribution: '',
    interactive: true,
    dataVar: 'json_municipalities_with_combined_risk_simplified_2',
    layerName: 'layer_municipalities_with_combined_risk_simplified_2',
    pane: 'pane_municipalities_with_combined_risk_simplified_2',
    onEachFeature: pop_municipalities_with_combined_risk_simplified_2,
    style: style_municipalities_with_combined_risk_simplified_2_0,
});
bounds_group.addLayer(layer_municipalities_with_combined_risk_simplified_2);
map.addLayer(layer_municipalities_with_combined_risk_simplified_2);
allLayers.municipal_risk = layer_municipalities_with_combined_risk_simplified_2;

// Dam buffers layer
function pop_snisb_dam_buffers_3(feature, layer) {
    layer.on({
        click: highlightFeature,
    });
    var popupContent = '<table>\
            <tr>\
                <td colspan="2" class="heritage-title"><strong>' + (feature.properties['dam_name'] !== null ? autolinker.link(String(feature.properties['dam_name']).replace(/'/g, '\'').toLocaleString()) : '') + '</strong></td>\
            </tr>\
            <tr>\
                <th scope="row">Estado</th>\
                <td>' + (feature.properties['state'] !== null ? autolinker.link(String(feature.properties['state']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Município</th>\
                <td>' + (feature.properties['municipality'] !== null ? autolinker.link(String(feature.properties['municipality']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Finalidade</th>\
                <td>' + (feature.properties['purpose'] !== null ? autolinker.link(String(feature.properties['purpose']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Categoria de Risco</th>\
                <td class="risk-score">' + (feature.properties['risk_category'] !== null ? autolinker.link(String(feature.properties['risk_category']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Potencial de Dano</th>\
                <td class="risk-score">' + (feature.properties['damage_potential'] !== null ? autolinker.link(String(feature.properties['damage_potential']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Risco ao Bem Cultural</th>\
                <td class="risk-score">' + (feature.properties['heritage_risk_potential'] !== null ? autolinker.link(String(feature.properties['heritage_risk_potential']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
        </table>';
    var content = removeEmptyRowsFromPopupContent(popupContent, feature);
    layer.on('popupopen', function(e) {
        addClassToPopupIfMedia(content, e.popup);
    });
    layer.bindPopup(content, { maxHeight: 400 });
}

function style_snisb_dam_buffers_3_0() {
    return {
        pane: 'pane_snisb_dam_buffers_3',
        opacity: 1,
        color: 'rgba(35,35,35,1.0)',
        dashArray: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        weight: 2.0, 
        fill: true,
        fillOpacity: 0.6,
        fillColor: 'rgba(231,113,72,0.6)',
        interactive: true,
    }
}

map.createPane('pane_snisb_dam_buffers_3');
map.getPane('pane_snisb_dam_buffers_3').style.zIndex = 403;
map.getPane('pane_snisb_dam_buffers_3').style['mix-blend-mode'] = 'normal';
var layer_snisb_dam_buffers_3 = new L.geoJson(json_snisb_dam_buffers_3, {
    attribution: '',
    interactive: true,
    dataVar: 'json_snisb_dam_buffers_3',
    layerName: 'layer_snisb_dam_buffers_3',
    pane: 'pane_snisb_dam_buffers_3',
    onEachFeature: pop_snisb_dam_buffers_3,
    style: style_snisb_dam_buffers_3_0,
});
bounds_group.addLayer(layer_snisb_dam_buffers_3);
map.addLayer(layer_snisb_dam_buffers_3);
allLayers.dam_buffers = layer_snisb_dam_buffers_3;

// Heritage sites layer with enhanced risk calculation
function pop_comprehensive_heritage_risk_4(feature, layer) {
    layer.on({
        click: highlightFeature,
    });

    var municipality = normalizeText(feature.properties['municipality'] || '');
    var uf = normalizeText(feature.properties['uf'] || '');
    var municipalityKey = municipality + '_' + uf;
    var icmClassification = window.icmData && window.icmData[municipalityKey] ? window.icmData[municipalityKey] : null;

    var icmBadge = '';
    if (icmClassification) {
        var icmColor = '';
        switch(icmClassification) {
            case 'A': icmColor = '#2E7D32'; break;
            case 'B': icmColor = '#1976D2'; break;
            case 'C': icmColor = '#F57F17'; break;
            case 'D': icmColor = '#C62828'; break;
            default: icmColor = '#757575';
        }
        icmBadge = '<span style="background-color: ' + icmColor + '; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: bold;">' + icmClassification + '</span>';
    } else {
        icmBadge = '<span style="background-color: #757575; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">N/A</span>';
    }

    // Use enhanced risk calculation instead of basic risk score
    var enhancedRisk = calculateEnhancedRisk(feature);
    var riskInfo = getEnhancedRiskLevel(enhancedRisk);

    var dominantType = getDominantRiskType(feature.properties);
    var dominantTypeLabel = 'Sem Risco';
    var dominantTypeColor = '#27ae60';

    if (dominantType === 'dam') {
        dominantTypeLabel = 'Risco de Barragens';
        dominantTypeColor = '#e77148';
    } else if (dominantType === 'fire') {
        dominantTypeLabel = 'Risco de Fogo';
        dominantTypeColor = '#e74c3c';
    } else if (dominantType === 'natural') {
        dominantTypeLabel = 'Risco Natural';
        dominantTypeColor = '#3498db';
    }

    var popupContent = '<table>\
            <tr>\
                <td colspan="2" class="heritage-title"><strong>' + (feature.properties['identificacao_bem'] !== null ? autolinker.link(String(feature.properties['identificacao_bem']).replace(/'/g, '\'').toLocaleString()) : 'Sítio de Bem Cultural') + '</strong></td>\
            </tr>\
            <tr>\
                <th scope="row">Natureza</th>\
                <td>' + (feature.properties['ds_natureza'] !== null ? autolinker.link(String(feature.properties['ds_natureza']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Tipo de Proteção</th>\
                <td>' + (feature.properties['ds_tipo_protecao'] !== null ? autolinker.link(String(feature.properties['ds_tipo_protecao']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Município</th>\
                <td>' + (feature.properties['municipality'] !== null ? autolinker.link(String(feature.properties['municipality']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Estado</th>\
                <td>' + (feature.properties['uf'] !== null ? autolinker.link(String(feature.properties['uf']).replace(/'/g, '\'').toLocaleString()) : '') + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Classificação ICM</th>\
                <td>' + icmBadge + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Nível de Risco (Melhorado)</th>\
                <td class="risk-score" style="background-color: ' + riskInfo.color + ' !important; color: white; font-weight: bold;">' + riskInfo.level + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Pontuação de Risco</th>\
                <td>' + enhancedRisk.toFixed(3) + '</td>\
            </tr>\
            <tr>\
                <th scope="row">Tipo de Risco Principal</th>\
                <td style="background-color: ' + dominantTypeColor + ' !important; color: white; font-weight: bold;">' + dominantTypeLabel + '</td>\
            </tr>\
        </table>';
    var content = removeEmptyRowsFromPopupContent(popupContent, feature);
    layer.on('popupopen', function(e) {
        addClassToPopupIfMedia(content, e.popup);
    });
    layer.bindPopup(content, { maxHeight: 400 });
}

function style_comprehensive_heritage_risk_4_0(feature) {
    var nature = String(feature.properties['ds_natureza'] || '');
    var enhancedRisk = calculateEnhancedRisk(feature);
    var riskInfo = getEnhancedRiskLevel(enhancedRisk);

    var baseStyle = {
        pane: 'pane_comprehensive_heritage_risk_4',
        radius: 4.0,
        opacity: 1,
        color: 'rgba(255,255,255,0.9)',
        dashArray: '',
        lineCap: 'butt',
        lineJoin: 'miter',
        weight: 2.0,
        fill: true,
        fillOpacity: 0.8,
        fillColor: riskInfo.color,
        interactive: true,
    };

    if (nature.includes('Imóvel') || nature.includes('Imovel') || nature.includes('Bem Imóvel')) {
        return baseStyle;
    } else if (nature.includes('Móvel') || nature.includes('Movel') || nature.includes('Bem Móvel')) {
        return Object.assign(baseStyle, { shape: 'diamond' });
    } else {
        return Object.assign(baseStyle, { shape: 'triangle' });
    }
}

map.createPane('pane_comprehensive_heritage_risk_4');
map.getPane('pane_comprehensive_heritage_risk_4').style.zIndex = 404;
map.getPane('pane_comprehensive_heritage_risk_4').style['mix-blend-mode'] = 'normal';
var layer_comprehensive_heritage_risk_4 = new L.geoJson(json_comprehensive_heritage_risk_4, {
    attribution: '',
    interactive: true,
    dataVar: 'json_comprehensive_heritage_risk_4',
    layerName: 'layer_comprehensive_heritage_risk_4',
    pane: 'pane_comprehensive_heritage_risk_4',
    onEachFeature: pop_comprehensive_heritage_risk_4,
    pointToLayer: function (feature, latlng) {
        var context = {
            feature: feature,
            variables: {}
        };
        return L.shapeMarker(latlng, style_comprehensive_heritage_risk_4_0(feature));
    },
});
bounds_group.addLayer(layer_comprehensive_heritage_risk_4);
map.addLayer(layer_comprehensive_heritage_risk_4);
allLayers.heritage = layer_comprehensive_heritage_risk_4;

/* ==========================================
   SEARCH FUNCTIONALITY
   ========================================== */

const url = {"Nominatim": "https://nominatim.openstreetmap.org/search?format=geojson&addressdetails=1&",
"BAN": "https://api-adresse.data.gouv.fr/search/?"}
var photonControl = L.control.photon({
    url: url["Nominatim"],
    feedbackLabel: '',
    position: 'topleft',
    includePosition: true,
    initial: true,
}).addTo(map);
photonControl._container.childNodes[0].style.borderRadius="10px"

var x = null;
var marker = null;
var z = null;
photonControl.on('selected', function(e) {
    console.log(photonControl.search.resultsContainer);
    if (x != null) {
        map.removeLayer(obj3.marker);
        map.removeLayer(x);
    }
    obj2.gcd = e.choice;
    x = L.geoJSON(obj2.gcd).addTo(map);
    var label = typeof obj2.gcd.properties.label === 'undefined' ? obj2.gcd.properties.display_name : obj2.gcd.properties.label;
    obj3.marker = L.marker(x.getLayers()[0].getLatLng()).bindPopup(label).addTo(map);
    map.setView(x.getLayers()[0].getLatLng(), 17);
    z = typeof e.choice.properties.label === 'undefined'? e.choice.properties.display_name : e.choice.properties.label;
    console.log(e);
    e.target.input.value = z;
});

var search = document.getElementsByClassName("leaflet-photon leaflet-control")[0];
search.classList.add("leaflet-control-search")
search.style.display = "flex";
search.style.backgroundColor="rgba(255,255,255,0.5)" 

var button = document.createElement("div");
button.id = "gcd-button-control";
button.className = "gcd-gl-btn fa fa-search search-button";

search.insertBefore(button, search.firstChild);
last = search.lastChild;
last.style.display = "none";
button.addEventListener("click", function (e) {
    if (last.style.display === "none") {
        last.style.display = "block";
    } else {
        last.style.display = "none";
    }
});

/* ==========================================
   LAYER CONTROL SETUP
   ========================================== */

var overlaysTree = [
    {label: 'Sítios de Bens Culturais<br /><table><tr><td style="text-align: center;"><div style="width:12px;height:12px;border-radius:50%;background:#f1c40f;display:inline-block;border:2px solid white;"></div></td><td>Bens Imóveis (Círculo)</td></tr><tr><td style="text-align: center;"><div style="width:12px;height:12px;background:#f1c40f;display:inline-block;border:2px solid white;transform:rotate(45deg);"></div></td><td>Bens Móveis (Losango)</td></tr></table>', layer: layer_comprehensive_heritage_risk_4},
    {label: 'Zonas de Risco de Barragens<br /><span style="color:#e77148;">Zonas de 5km ao Redor de Barragens</span>', layer: layer_snisb_dam_buffers_3},
    {label: 'Áreas de Risco Municipal<br /><table><tr><td style="background:#f1c40f;width:20px;height:15px;"></td><td>Risco Médio</td></tr><tr><td style="background:#e67e22;width:20px;height:15px;"></td><td>Risco Alto</td></tr><tr><td style="background:#e74c3c;width:20px;height:15px;"></td><td>Risco Muito Alto</td></tr></table>', layer: layer_municipalities_with_combined_risk_simplified_2},
    {label: 'Limites Municipais', layer: layer_municipalities_1_simplified_1},
    {label: "Mapa Base", layer: layer_OpenStreetMap_0},
]

var lay = L.control.layers.tree(null, overlaysTree,{
    collapsed: true,
});
lay.addTo(map);

/* ==========================================
   STATE NAVIGATION FUNCTIONALITY
   ========================================== */

var stateNames = {
    'AC': 'Acre',
    'AL': 'Alagoas', 
    'AP': 'Amapá',
    'AM': 'Amazonas',
    'BA': 'Bahia',
    'CE': 'Ceará',
    'DF': 'Distrito Federal',
    'ES': 'Espírito Santo',
    'GO': 'Goiás',
    'MA': 'Maranhão',
    'MT': 'Mato Grosso',
    'MS': 'Mato Grosso do Sul',
    'MG': 'Minas Gerais',
    'PA': 'Pará',
    'PB': 'Paraíba',
    'PR': 'Paraná',
    'PE': 'Pernambuco',
    'PI': 'Piauí',
    'RJ': 'Rio de Janeiro',
    'RN': 'Rio Grande do Norte',
    'RS': 'Rio Grande do Sul',
    'RO': 'Rondônia',
    'RR': 'Roraima',
    'SC': 'Santa Catarina',
    'SP': 'São Paulo',
    'SE': 'Sergipe',
    'TO': 'Tocantins'
};

var stateCenters = {
    'AC': [-9.0238, -70.8120],
    'AL': [-9.5713, -36.7820],
    'AP': [1.4148, -51.7799],
    'AM': [-4.9609, -61.9927],
    'BA': [-12.5797, -41.7007],
    'CE': [-5.4984, -39.3206],
    'DF': [-15.7998, -47.8645],
    'ES': [-19.1834, -40.3089],
    'GO': [-15.827, -49.8362],
    'MA': [-4.9609, -45.2744],
    'MT': [-12.6819, -56.9211],
    'MS': [-20.7722, -54.7852],
    'MG': [-18.5122, -44.5550],
    'PA': [-3.9097, -52.4829],
    'PB': [-7.2399, -36.7820],
    'PR': [-24.8932, -51.4248],
    'PE': [-8.8137, -36.9541],
    'PI': [-8.5811, -42.7297],
    'RJ': [-22.9099, -43.2095],
    'RN': [-5.4026, -36.9541],
    'RS': [-30.0346, -51.2177],
    'RO': [-10.9472, -63.0234],
    'RR': [2.7376, -62.0751],
    'SC': [-27.2423, -50.2189],
    'SP': [-23.5505, -46.6333],
    'SE': [-10.5741, -37.3857],
    'TO': [-10.184, -48.2982]
};

function navigateToState() {
    var dropdown = document.getElementById('stateDropdown');
    var selectedState = dropdown.value;

    if (!selectedState) {
        document.getElementById('stateInfo').style.display = 'none';
        return;
    }

    document.getElementById('stateInfo').style.display = 'block';
    document.getElementById('selectedStateName').textContent = stateNames[selectedState];

    var coordinates = stateCenters[selectedState];
    if (coordinates) {
        map.setView([coordinates[0], coordinates[1]], 7);
        updateStateStatistics(selectedState);
        console.log('Navegated to state:', stateNames[selectedState], '(' + selectedState + ')');
    }
}

function updateStateStatistics(stateCode) {
    var heritageCount = 0;
    var municipalityCount = 0;

    if (allLayers.heritage) {
        allLayers.heritage.eachLayer(function(layer) {
            var featureState = layer.feature.properties['uf'];
            if (featureState === stateCode) {
                heritageCount++;
            }
        });
    }

    if (allLayers.municipal_boundaries) {
        allLayers.municipal_boundaries.eachLayer(function(layer) {
            var featureState = layer.feature.properties['SIGLA_UF'];
            if (featureState === stateCode) {
                municipalityCount++;
            }
        });
    }
    document.getElementById('stateHeritageCount').textContent = heritageCount;
    document.getElementById('stateMunicipalityCount').textContent = municipalityCount;
}

function resetStateSelection() {
    document.getElementById('stateDropdown').value = '';
    document.getElementById('stateInfo').style.display = 'none';
    setBounds();
    console.log('Reset to full Brazil view');
}

/* ==========================================
   INITIALIZATION
   ========================================== */

/* ==========================================
   INITIALIZATION
   ========================================== */

setBounds();
updateTimestamp();

// Use progressive loading instead of setTimeout
initializeProgressiveLoading();