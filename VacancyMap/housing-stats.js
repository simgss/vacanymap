class HousingStats {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.baseUrl = 'https://api.census.gov/data/2022/acs/acs5';
        this.tigerUrl = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
        this.variables = {
            totalHousing: 'B25002_001E',    // Total housing units
            vacant: 'B25002_003E',          // Vacant units
        };
        this.map = null;
        this.layers = {
            state: null,
            county: null,
            tract: null,
            block: null
        };
        this.selectedState = null;
        this.selectedCounty = null;
        this.selectedTract = null;
        this.selectedBlock = null;
        
        this.init();
    }

    async init() {
        try {
            await this.createUI();
            await this.initMap();
            await this.loadStates();
        } catch (error) {
            this.showError('Failed to initialize: ' + error.message);
        }
    }

    async createUI() {
        this.container.innerHTML = `
            <div class="max-w-6xl mx-auto p-4">
                <h1 class="text-2xl font-bold mb-4">Housing Vacancy Rates (2022)</h1>
                
                <div class="grid grid-cols-1 gap-4 mb-4">
                    <div class="bg-white p-4 rounded-lg shadow">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700">State</label>
                                <select id="stateSelect" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm">
                                    <option value="">Select State</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">County</label>
                                <select id="countySelect" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm" disabled>
                                    <option value="">Select County</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Geography Level</label>
                                <select id="geoLevel" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm">
                                    <option value="state">State</option>
                                    <option value="county">County</option>
                                    <option value="tract">Census Tract</option>
                                    <option value="block">Block Group</option>
                                </select>
                            </div>
                        </div>
                        <div id="map" style="height: 600px;" class="rounded-lg"></div>
                        <div class="mt-4 flex justify-center items-center space-x-4">
                            <span class="text-sm">Low Vacancy</span>
                            <div class="w-48 h-4 bg-gradient-to-r from-yellow-100 via-orange-300 to-red-600 rounded"></div>
                            <span class="text-sm">High Vacancy</span>
                        </div>
                    </div>
                </div>

                <div id="statsContainer" class="bg-white p-4 rounded-lg shadow">
                    <!-- Statistics will be loaded here -->
                </div>
            </div>
        `;

        this.setupEventListeners();
    }

    setupEventListeners() {
        const stateSelect = document.getElementById('stateSelect');
        const countySelect = document.getElementById('countySelect');
        const geoLevel = document.getElementById('geoLevel');

        stateSelect.addEventListener('change', async (e) => {
            this.selectedState = e.target.value;
            if (this.selectedState) {
                await this.loadCounties(this.selectedState);
                await this.updateMap('state', this.selectedState);
            }
        });

        countySelect.addEventListener('change', async (e) => {
            this.selectedCounty = e.target.value;
            if (this.selectedCounty) {
                await this.updateMap('county', this.selectedCounty);
            }
        });

        geoLevel.addEventListener('change', async (e) => {
            if (this.selectedState) {
                await this.updateMap(e.target.value, this.selectedState);
            }
        });
    }

    async initMap() {
        this.map = L.map('map').setView([37.8, -96], 4);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);

        // Load and display all states with colors immediately
        await this.showAllStates();
    }

    async showAllStates() {
        try {
            // Fetch state boundaries
            const response = await fetch('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json');
            const statesGeoJson = await response.json();

            // Fetch vacancy data for all states
            const vacancyResponse = await fetch(
                `${this.baseUrl}?get=NAME,${this.variables.totalHousing},${this.variables.vacant}&for=state:*`
            );
            const [headers, ...stateData] = await vacancyResponse.json();

            // Process vacancy data
            const vacancyRates = {};
            stateData.forEach(row => {
                const totalHousing = parseInt(row[headers.indexOf(this.variables.totalHousing)]) || 0;
                const vacant = parseInt(row[headers.indexOf(this.variables.vacant)]) || 0;
                const rate = totalHousing > 0 ? (vacant / totalHousing * 100) : 0;
                const stateId = row[row.length - 1];
                vacancyRates[stateId] = rate;
            });

            // Create the layer with colored states
            this.layers.state = L.geoJSON(statesGeoJson, {
                style: (feature) => {
                    const stateId = feature.properties.STATEFP;
                    const rate = vacancyRates[stateId] || 0;
                    
                    return {
                        fillColor: this.getColor(rate),
                        weight: 1,
                        opacity: 1,
                        color: 'white',
                        fillOpacity: 0.7
                    };
                },
                onEachFeature: (feature, layer) => {
                    const stateId = feature.properties.STATEFP;
                    const rate = vacancyRates[stateId] || 0;
                    
                    // Add hover effect
                    layer.on({
                        mouseover: (e) => {
                            const layer = e.target;
                            layer.setStyle({
                                weight: 2,
                                color: '#666',
                                fillOpacity: 0.9
                            });
                            layer.bindPopup(
                                `<strong>${feature.properties.NAME}</strong><br>` +
                                `Vacancy Rate: ${rate.toFixed(1)}%`
                            ).openPopup();
                        },
                        mouseout: (e) => {
                            this.layers.state.resetStyle(e.target);
                        }
                    });
                }
            }).addTo(this.map);

            // Update the stats display
            const statsData = stateData.map(row => ({
                name: row[0],
                geoid: row[row.length - 1],
                totalHousing: parseInt(row[headers.indexOf(this.variables.totalHousing)]) || 0,
                vacant: parseInt(row[headers.indexOf(this.variables.vacant)]) || 0,
                vacancyRate: vacancyRates[row[row.length - 1]].toFixed(1)
            }));

            this.updateStats(statsData, 'state');

        } catch (error) {
            console.error('Error loading states:', error);
            this.showError('Failed to load state data');
        }
    }

    getColor(rate) {
        return rate > 20 ? '#800026' :  // Dark red
               rate > 15 ? '#BD0026' :  // Red
               rate > 10 ? '#E31A1C' :  // Lighter red
               rate > 7.5 ? '#FC4E2A' : // Orange-red
               rate > 5 ? '#FD8D3C' :   // Orange
               rate > 2.5 ? '#FEB24C' : // Light orange
               rate > 0 ? '#FED976' :   // Yellow
                         '#FFEDA0';     // Light yellow
    }

    async loadStates() {
        try {
            const response = await fetch(
                `${this.baseUrl}?get=NAME&for=state:*`
            );
            const data = await response.json();
            const states = data.slice(1).map(([name, id]) => ({name, id}));
            
            const stateSelect = document.getElementById('stateSelect');
            stateSelect.innerHTML = `
                <option value="">Select State</option>
                ${states.map(state => 
                    `<option value="${state.id}">${state.name}</option>`
                ).join('')}
            `;
        } catch (error) {
            this.showError('Failed to load states: ' + error.message);
        }
    }

    async loadCounties(stateId) {
        try {
            const response = await fetch(
                `${this.baseUrl}?get=NAME&for=county:*&in=state:${stateId}`
            );
            const data = await response.json();
            const counties = data.slice(1).map(([name, , id]) => ({
                name: name.split(',')[0],
                id
            }));
            
            const countySelect = document.getElementById('countySelect');
            countySelect.innerHTML = `
                <option value="">Select County</option>
                ${counties.map(county => 
                    `<option value="${county.id}">${county.name}</option>`
                ).join('')}
            `;
            countySelect.disabled = false;
        } catch (error) {
            this.showError('Failed to load counties: ' + error.message);
        }
    }

    async updateMap(level, geoId) {
        // Remove all existing layers
        Object.values(this.layers).forEach(layer => {
            if (layer) {
                this.map.removeLayer(layer);
            }
        });

        const geoJson = await this.fetchGeoJSON(level, geoId);
        const vacancyData = await this.fetchVacancyData(level, geoId);

        // Create new layer with ID
        this.layers[level] = L.geoJSON(geoJson, {
            id: `${level}-layer`,
            style: (feature) => {
                // Get state ID from feature
                const stateId = feature.properties.STATEFP || feature.properties.STATE;
                // Find matching vacancy data
                const data = vacancyData.find(d => d.geoid === stateId);
                // Get vacancy rate or default to 0
                const rate = data ? parseFloat(data.vacancyRate) : 0;

                return {
                    fillColor: this.getColor(rate),
                    weight: 1,
                    opacity: 1,
                    color: 'white',
                    fillOpacity: 0.7
                };
            }
        }).addTo(this.map);

        this.map.fitBounds(this.layers[level].getBounds());
        this.updateStats(vacancyData, level);
    }

    async fetchGeoJSON(level, geoId) {
        let url;
        const params = new URLSearchParams();
        params.append('outFields', '*');
        params.append('f', 'geojson');
        
        switch (level) {
            case 'state':
                url = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';
                break;
            case 'county':
                url = `${this.tigerUrl}/State_County/MapServer/0/query`;
                params.append('where', `STATE='${this.selectedState}'`);
                break;
            case 'tract':
                url = `${this.tigerUrl}/Tracts_Blocks/MapServer/2/query`;
                params.append('where', `STATE='${this.selectedState}'${
                    this.selectedCounty ? ` AND COUNTY='${this.selectedCounty}'` : ''
                }`);
                break;
            case 'block':
                url = `${this.tigerUrl}/Tracts_Blocks/MapServer/1/query`;
                params.append('where', `STATE='${this.selectedState}'${
                    this.selectedCounty ? ` AND COUNTY='${this.selectedCounty}'` : ''
                }`);
                break;
        }

        const response = await fetch(level === 'state' ? url : `${url}?${params}`);
        return await response.json();
    }

    async fetchVacancyData(level, geoId) {
        let url = this.baseUrl;
        let params = new URLSearchParams({
            get: `NAME,${Object.values(this.variables).join(',')}`,
            for: `${level}:*`
        });

        if (level !== 'state') {
            params.append('in', `state:${this.selectedState}`);
            if (level === 'tract' || level === 'block') {
                params.append('in', `county:${this.selectedCounty}`);
            }
        }

        const response = await fetch(`${url}?${params}`);
        const [headers, ...rows] = await response.json();

        return rows.map(row => {
            const totalHousing = parseInt(row[headers.indexOf(this.variables.totalHousing)]) || 0;
            const vacant = parseInt(row[headers.indexOf(this.variables.vacant)]) || 0;
            const vacancyRate = totalHousing > 0 ? ((vacant / totalHousing) * 100).toFixed(1) : '0.0';

            return {
                name: row[0],
                geoid: this.getGeoIdFromResponse(row, level),
                totalHousing,
                vacant,
                vacancyRate
            };
        });
    }

    getGeoId(feature, level) {
        switch (level) {
            case 'state':
                return feature.properties.STATE || feature.properties.STATEFP;
            case 'county':
                return feature.properties.COUNTYFP;
            case 'tract':
                return feature.properties.TRACTCE;
            case 'block':
                return feature.properties.BLOCKCE;
            default:
                return null;
        }
    }

    getGeoIdFromResponse(row, level) {
        const stateIndex = row.length - 1;
        const countyIndex = row.length - 2;
        const tractIndex = row.length - 3;
        const blockIndex = row.length - 4;

        switch (level) {
            case 'state':
                return row[stateIndex];
            case 'county':
                return row[countyIndex];
            case 'tract':
                return row[tractIndex];
            case 'block':
                return row[blockIndex];
            default:
                return null;
        }
    }

    updateStats(data, level) {
        const statsContainer = document.getElementById('statsContainer');
        const totalVacant = data.reduce((sum, d) => sum + d.vacant, 0);
        const totalUnits = data.reduce((sum, d) => sum + d.totalHousing, 0);
        const avgVacancyRate = (totalVacant / totalUnits * 100).toFixed(1);

        // Sort data by vacancy rate
        const sortedData = [...data].sort((a, b) => parseFloat(b.vacancyRate) - parseFloat(a.vacancyRate));
        const levelName = {
            state: 'State',
            county: 'County',
            tract: 'Census Tract',
            block: 'Block Group'
        }[level];

        statsContainer.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h2 class="text-lg font-semibold mb-4">Summary Statistics</h2>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="p-4 bg-gray-50 rounded-lg">
                            <div class="text-sm text-gray-600">Average Vacancy Rate</div>
                            <div class="text-2xl font-bold">${avgVacancyRate}%</div>
                        </div>
                        <div class="p-4 bg-gray-50 rounded-lg">
                            <div class="text-sm text-gray-600">Total Vacant Units</div>
                            <div class="text-2xl font-bold">${totalVacant.toLocaleString()}</div>
                        </div>
                    </div>
                </div>

                <div>
                    <h2 class="text-lg font-semibold mb-4">Highest Vacancy Rates</h2>
                    <div class="overflow-x-auto">
                        <table class="min-w-full">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-4 py-2 text-left">${levelName}</th>
                                    <th class="px-4 py-2 text-right">Vacancy Rate</th>
                                    <th class="px-4 py-2 text-right">Vacant Units</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${sortedData.slice(0, 5).map(d => `
                                    <tr class="border-t">
                                        <td class="px-4 py-2">${d.name}</td>
                                        <td class="px-4 py-2 text-right">${d.vacancyRate}%</td>
                                        <td class="px-4 py-2 text-right">${d.vacant.toLocaleString()}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="mt-6">
                <h2 class="text-lg font-semibold mb-4">Complete Data Table</h2>
                <div class="overflow-x-auto">
                    <table class="min-w-full">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-2 text-left">${levelName}</th>
                                <th class="px-4 py-2 text-right">Total Units</th>
                                <th class="px-4 py-2 text-right">Vacant Units</th>
                                <th class="px-4 py-2 text-right">Vacancy Rate</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedData.map(d => `
                                <tr class="border-t hover:bg-gray-50">
                                    <td class="px-4 py-2">${d.name}</td>
                                    <td class="px-4 py-2 text-right">${d.totalHousing.toLocaleString()}</td>
                                    <td class="px-4 py-2 text-right">${d.vacant.toLocaleString()}</td>
                                    <td class="px-4 py-2 text-right">${d.vacancyRate}%</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    showError(message) {
        this.container.innerHTML = `
            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                ${message}
            </div>
        `;
    }
}