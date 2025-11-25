const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
const cache = new NodeCache({ stdTTL: 3600 });

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, try again later'
});
app.use('/api/', limiter);

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  console.error('GOOGLE_MAPS_API_KEY not set');
  process.exit(1);
}

async function makeGoogleRequest(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google API error: ${response.status}`);
  }
  return response.json();
}

app.get('/api/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const cacheKey = `geocode_${address}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await makeGoogleRequest(url);

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error('Geocode error:', error);
    res.status(500).json({ error: 'Failed to geocode' });
  }
});

app.get('/api/reverse-geocode', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Lat/lng required' });
    }

    const cacheKey = `reverse_${lat}_${lng}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await makeGoogleRequest(url);

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error('Reverse geocode error:', error);
    res.status(500).json({ error: 'Failed to reverse geocode' });
  }
});

app.get('/api/places/nearby', async (req, res) => {
  try {
    const { lat, lng, radius, type } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Lat/lng required' });
    }

    const searchRadius = radius || 1000;
    const placeType = type || 'restaurant';

    const cacheKey = `nearby_${lat}_${lng}_${searchRadius}_${placeType}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&type=${placeType}&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await makeGoogleRequest(url);

    // filter low ratings
    if (data.results) {
      data.results = data.results.filter(place => place.rating >= 4.0);
    }

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error('Nearby search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/places/details', async (req, res) => {
  try {
    const { place_id } = req.query;
    
    if (!place_id) {
      return res.status(400).json({ error: 'place_id required' });
    }

    const cacheKey = `details_${place_id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const fields = 'name,rating,user_ratings_total,price_level,opening_hours,formatted_address,geometry,types,website,formatted_phone_number';
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await makeGoogleRequest(url);

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error('Details error:', error);
    res.status(500).json({ error: 'Failed to get details' });
  }
});

app.get('/api/distance', async (req, res) => {
  try {
    const { origin_lat, origin_lng, dest_lat, dest_lng } = req.query;
    
    if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
      return res.status(400).json({ error: 'Origin and destination required' });
    }

    const cacheKey = `distance_${origin_lat}_${origin_lng}_${dest_lat}_${dest_lng}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const origin = `${origin_lat},${origin_lng}`;
    const destination = `${dest_lat},${dest_lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=walking&key=${GOOGLE_MAPS_API_KEY}`;
    const data = await makeGoogleRequest(url);

    cache.set(cacheKey, data);
    res.json(data);
  } catch (error) {
    console.error('Distance error:', error);
    res.status(500).json({ error: 'Distance calculation failed' });
  }
});

// main search endpoint
app.post('/api/combos/search', async (req, res) => {
  try {
    const { lat, lng, radius } = req.body;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Location required' });
    }

    const searchRadius = radius || 1000;

    const [restaurantsUrl, barsUrl] = [
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&type=restaurant&key=${GOOGLE_MAPS_API_KEY}`,
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&type=bar&key=${GOOGLE_MAPS_API_KEY}`
    ];

    const [restaurantsData, barsData] = await Promise.all([
      makeGoogleRequest(restaurantsUrl),
      makeGoogleRequest(barsUrl)
    ]);

    const restaurants = (restaurantsData.results || []).filter(r => r.rating >= 4.0);
    const bars = (barsData.results || []).filter(b => b.rating >= 4.0);

    const combos = [];
    
    for (const restaurant of restaurants.slice(0, 10)) {
      for (const bar of bars.slice(0, 10)) {
        const distance = calculateDistance(
          restaurant.geometry.location.lat,
          restaurant.geometry.location.lng,
          bar.geometry.location.lat,
          bar.geometry.location.lng
        );

        // only walkable combos
        if (distance <= 0.5) {
          combos.push({
            restaurant: {
              place_id: restaurant.place_id,
              name: restaurant.name,
              rating: restaurant.rating,
              user_ratings_total: restaurant.user_ratings_total,
              price_level: restaurant.price_level,
              vicinity: restaurant.vicinity,
              types: restaurant.types,
              geometry: restaurant.geometry
            },
            bar: {
              place_id: bar.place_id,
              name: bar.name,
              rating: bar.rating,
              user_ratings_total: bar.user_ratings_total,
              vicinity: bar.vicinity,
              types: bar.types,
              geometry: bar.geometry
            },
            distance: distance,
            walkTime: Math.round((distance / 5) * 60),
            comboRating: Math.round(((restaurant.rating + bar.rating) / 2) * 10) / 10
          });
        }
      }
    }

    combos.sort((a, b) => b.comboRating - a.comboRating);

    res.json({
      success: true,
      count: combos.length,
      combos: combos
    });

  } catch (error) {
    console.error('Combo search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/cache/stats', (req, res) => {
  const stats = cache.getStats();
  res.json(stats);
});

// TODO: add auth
app.post('/api/cache/clear', (req, res) => {
  cache.flushAll();
  res.json({ success: true, message: 'Cache cleared' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`BestNight API running on port ${PORT}`);
  console.log(`Google Maps API key: ${GOOGLE_MAPS_API_KEY ? '✓' : '✗'}`);
});

module.exports = app;