// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoia2F3ZW4yNSIsImEiOiJjbTdlY28yOHowY3FzMnRvY2J5bjVjOGt6In0.-qZ7mvFWWHDJySIf3XKDIA';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', 
    style: 'mapbox://styles/mapbox/streets-v12', 
    center: [-71.09415, 42.36027], 
    zoom: 12, 
    minZoom: 5, 
    maxZoom: 18 
});

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', async () => {
    // Add bike lane sources & layers
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: {
            'line-color': 'green',
            'line-width': 3,
            'line-opacity': 0.4
        }
    });

    // Create an SVG layer inside the map container
    const svg = d3.select('#map').select('svg');

    // Fetch station and traffic data in parallel
    const stationsUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    try {
        const [jsonData, trips] = await Promise.all([
          d3.json(stationsUrl),
          d3.csv(trafficUrl, (trip) => {
              trip.started_at = new Date(trip.started_at);
              trip.ended_at = new Date(trip.ended_at);
              return trip;
          })
      ]);

        console.log('Loaded JSON Data:', jsonData);
        console.log('Loaded traffic csv data:', trips);

        let stations = computeStationTraffic(jsonData.data.stations, trips);

        // Calculate departures and arrivals using d3.rollup
        const departures = d3.rollup(
            trips,
            v => v.length,
            d => d.start_station_id
        );

        const arrivals = d3.rollup(
            trips,
            v => v.length,
            d => d.end_station_id
        );

        // Update station data with traffic info
        stations = stations.map(station => {
            let id = station.short_name;
            station.arrivals = arrivals.get(id) ?? 0;
            station.departures = departures.get(id) ?? 0;
            station.totalTraffic = station.arrivals + station.departures;
            return station;
        });

        console.log('Updated Stations:', stations);

        // Define a square root scale for circle radii
        const radiusScale = d3.scaleSqrt()
            .domain([0, d3.max(stations, d => d.totalTraffic)])
            .range([2, 25]); // Ensure minimum size is >0

        // Function to update circle positions
        function updatePositions() {
          const bounds = map.getBounds(); // Get visible area of the map

          circles
              .attr("cx", d => {
                  const { cx } = getCoords(d);
                  return (d.lon >= bounds.getWest() && d.lon <= bounds.getEast()) ? cx : -1000; // Move off-screen if outside
              })
              .attr("cy", d => {
                  const { cy } = getCoords(d);
                  return (d.lat >= bounds.getSouth() && d.lat <= bounds.getNorth()) ? cy : -1000;
              });
        }

        // Append circles for stations
        let circles = svg.selectAll('circle')
            .data(stations, (d) => d.short_name)  // Use station short_name as the key
            .join('circle')
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 2)
            .attr('opacity', 0.6)
            .attr('r', d => radiusScale(d.totalTraffic)) // Apply scale
            .each(function(d) {
                d3.select(this)
                    .append('title')
                    .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            })
            .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
            

        // Initial update
        updatePositions();

        // Update positions on map interactions
        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        const timeSlider = document.getElementById('time-slider');
        const selectedTime = document.getElementById('selected-time');
        const anyTimeLabel = document.getElementById('any-time');

        function updateTimeDisplay() {
          timeFilter = Number(timeSlider.value);  // Get slider value
        
          if (timeFilter === -1) {
            selectedTime.textContent = '';  // Clear time display
            anyTimeLabel.style.display = 'block';  // Show "(any time)"
          } else {
            selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
            anyTimeLabel.style.display = 'none';  // Hide "(any time)"
          }
        
          // Call updateScatterPlot to reflect the changes on the map
          updateScatterPlot(timeFilter)
        }

        timeSlider.addEventListener('input', updateTimeDisplay);
        updateTimeDisplay();

        function updateScatterPlot(timeFilter) {
          // Get only the trips that match the selected time filter
          const filteredTrips = filterTripsbyTime(trips, timeFilter);
          
          // Recompute station traffic based on the filtered trips
          const filteredStations = computeStationTraffic(stations, filteredTrips);
          
          // Dynamically adjust the radius scale based on filtering
          timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

          // Update the scatterplot by adjusting the radius of circles
          circles
            .data(filteredStations, (d) => d.short_name)  // Ensure D3 tracks elements correctly
            .join('circle') // Ensure the data is bound correctly
            .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
            .style('--departure-ratio', (d) =>
              stationFlow(d.departures / d.totalTraffic),
          );
      }

        

    } catch (error) {
        console.error('Error loading data:', error);
    }
});

// Function to convert station coordinates to SVG coordinates
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
      trips, 
      (v) => v.length, 
      (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
      trips, 
      (v) => v.length, 
      (d) => d.end_station_id
  );

  return stations.map((station) => {
      let id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  return timeFilter === -1 
    ? trips // If no filter is applied (-1), return all trips
    : trips.filter((trip) => {
        // Convert trip start and end times to minutes since midnight
        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);
        
        // Include trips that started or ended within 60 minutes of the selected time
        return (
          Math.abs(startedMinutes - timeFilter) <= 60 ||
          Math.abs(endedMinutes - timeFilter) <= 60
        );
    });
}