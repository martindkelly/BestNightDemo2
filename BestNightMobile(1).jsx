// BestNight - React Native Mobile App
// This compiles to APK (Android) and IPA (iOS)

import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
  Share,
  Platform,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

// API Configuration
const API_BASE_URL = 'http://192.168.1.48:3001/api'; // Update with your backend URL

const BestNightApp = () => {
  const [screen, setScreen] = useState('home');
  const [location, setLocation] = useState('');
  const [detectedLocation, setDetectedLocation] = useState('');
  const [userCoords, setUserCoords] = useState(null);
  const [combos, setCombos] = useState([]);
  const [selectedCombo, setSelectedCombo] = useState(null);
  const [filter, setFilter] = useState('all');
  const [favorites, setFavorites] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState('rating');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchRadius, setSearchRadius] = useState(1000);
  
  // New filter states
  const [selectedCuisine, setSelectedCuisine] = useState('all');
  const [selectedPriceLevel, setSelectedPriceLevel] = useState('all');
  const [minRating, setMinRating] = useState(0);
  const [maxDistance, setMaxDistance] = useState(2000); // in meters

  // Load favorites from AsyncStorage
  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const saved = await AsyncStorage.getItem('bestnight_favorites');
      if (saved) {
        setFavorites(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load favorites:', e);
    }
  };

  const saveFavorites = async (newFavorites) => {
    try {
      await AsyncStorage.setItem('bestnight_favorites', JSON.stringify(newFavorites));
    } catch (e) {
      console.error('Failed to save favorites:', e);
    }
  };

  // API Helper Functions
  const apiRequest = async (endpoint, options = {}) => {
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'API request failed');
      }

      return await response.json();
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  };

  // Get current location using Expo Location
  const handleLocationDetection = async () => {
    setLoading(true);
    setError(null);

    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        setError('Location permission denied. Please enable in settings.');
        setLoading(false);
        return;
      }

      // Get current location
      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
      };

      setUserCoords(coords);

      // Get location name
      const locationName = await reverseGeocode(coords);
      setDetectedLocation(locationName);

      // DON'T automatically fetch combos - wait for user to click "Find Locations"
    } catch (err) {
      setError('Failed to get location. Please try manual entry.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Reverse geocode
  const reverseGeocode = async (coords) => {
    try {
      const data = await apiRequest(`/reverse-geocode?lat=${coords.lat}&lng=${coords.lng}`);
      
      if (data.results && data.results[0]) {
        const addressComponents = data.results[0].address_components;
        const locality = addressComponents.find(c => c.types.includes('locality'));
        return locality ? locality.long_name : data.results[0].formatted_address;
      }
      return 'Unknown location';
    } catch (err) {
      console.error('Geocoding error:', err);
      return 'Unknown location';
    }
  };

  // Geocode manual address
  const handleManualLocation = async () => {
    if (!location.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await apiRequest(`/geocode?address=${encodeURIComponent(location)}`);

      if (data.results && data.results[0]) {
        const coords = {
          lat: data.results[0].geometry.location.lat,
          lng: data.results[0].geometry.location.lng,
        };
        setUserCoords(coords);

        const locationName = await reverseGeocode(coords);
        setDetectedLocation(locationName);

        // DON'T automatically fetch - wait for user to click "Find Locations"
      } else {
        setError('Location not found. Please try a different address.');
      }
    } catch (err) {
      setError('Failed to find location. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // NEW: Handler for "Find Locations" button
  const handleFindLocations = async () => {
    if (!userCoords) {
      setError('Please detect or enter a location first.');
      return;
    }
    await fetchCombos(userCoords);
  };

  // Fetch combos
  const fetchCombos = async (coords) => {
    try {
      setLoading(true);

      const data = await apiRequest('/combos/search', {
        method: 'POST',
        body: JSON.stringify({
          lat: coords.lat,
          lng: coords.lng,
          radius: searchRadius,
        }),
      });

      if (data.success && data.combos) {
        const enrichedCombos = data.combos.map(combo => ({
          id: `${combo.restaurant.place_id}_${combo.bar.place_id}`,
          restaurant: {
            name: combo.restaurant.name,
            rating: combo.restaurant.rating,
            reviews: combo.restaurant.user_ratings_total || 0,
            cuisine: formatCuisineType(combo.restaurant.types),
            priceLevel: getPriceLevel(combo.restaurant.price_level),
            location: combo.restaurant.vicinity,
            placeId: combo.restaurant.place_id,
            coords: {
              lat: combo.restaurant.geometry.location.lat,
              lng: combo.restaurant.geometry.location.lng,
            },
          },
          bar: {
            name: combo.bar.name,
            rating: combo.bar.rating,
            reviews: combo.bar.user_ratings_total || 0,
            features: formatBarFeatures(combo.bar.types),
            location: combo.bar.vicinity,
            placeId: combo.bar.place_id,
            coords: {
              lat: combo.bar.geometry.location.lat,
              lng: combo.bar.geometry.location.lng,
            },
          },
          distance: Math.round(combo.distance * 100) / 100,
          distanceKm: combo.distance,
          walkTime: combo.walkTime,
          comboRating: combo.comboRating,
        }));

        setCombos(enrichedCombos);
        setScreen('results');

        if (enrichedCombos.length === 0) {
          setError('No combos found. Try increasing search radius.');
        }
      } else {
        setError('No combos found. Please try a different location.');
      }
    } catch (err) {
      console.error('Error fetching combos:', err);
      setError('Failed to fetch venues. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle combo selection
  const handleComboSelect = async (combo) => {
    setLoading(true);

    try {
      const [restaurantData, barData] = await Promise.all([
        apiRequest(`/places/details?place_id=${combo.restaurant.placeId}`),
        apiRequest(`/places/details?place_id=${combo.bar.placeId}`),
      ]);

      const restaurantDetails = restaurantData.result;
      const barDetails = barData.result;

      const enrichedCombo = {
        ...combo,
        restaurant: {
          ...combo.restaurant,
          hours: restaurantDetails.opening_hours?.weekday_text?.[new Date().getDay()] || 'Hours not available',
          address: restaurantDetails.formatted_address,
          website: restaurantDetails.website,
          phone: restaurantDetails.formatted_phone_number,
        },
        bar: {
          ...combo.bar,
          hours: barDetails.opening_hours?.weekday_text?.[new Date().getDay()] || 'Hours not available',
          address: barDetails.formatted_address,
          website: barDetails.website,
          phone: barDetails.formatted_phone_number,
        },
      };

      setSelectedCombo(enrichedCombo);
      setScreen('details');
    } catch (err) {
      console.error('Error fetching details:', err);
      Alert.alert('Error', 'Failed to load details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Helper functions
  const formatCuisineType = (types) => {
    if (!types) return 'Restaurant';
    const cuisineTypes = types.filter(
      t => !['restaurant', 'food', 'point_of_interest', 'establishment'].includes(t)
    );
    return cuisineTypes[0] ? formatType(cuisineTypes[0]) : 'Restaurant';
  };

  const formatBarFeatures = (types) => {
    if (!types) return [];
    return types
      .filter(t => !['bar', 'point_of_interest', 'establishment'].includes(t))
      .slice(0, 3)
      .map(formatType);
  };

  const formatType = (type) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getPriceLevel = (level) => {
    if (!level) return '£';
    return '£'.repeat(level);
  };

  const toggleFavorite = (comboId) => {
    let newFavorites;
    if (favorites.includes(comboId)) {
      newFavorites = favorites.filter(id => id !== comboId);
    } else {
      newFavorites = [...favorites, comboId];
    }
    setFavorites(newFavorites);
    saveFavorites(newFavorites);
  };

  const handleShare = async () => {
    if (!selectedCombo) return;

    try {
      await Share.share({
        message: `Check out this BestNight combo:\n\nDinner: ${selectedCombo.restaurant.name}\nDrinks: ${selectedCombo.bar.name}\n\nPerfect for a great night out!`,
      });
    } catch (err) {
      console.error('Error sharing:', err);
    }
  };

  const openInMaps = (coords, name) => {
    const url = Platform.select({
      ios: `maps:0,0?q=${name}@${coords.lat},${coords.lng}`,
      android: `geo:0,0?q=${coords.lat},${coords.lng}(${name})`,
    });
    Linking.openURL(url);
  };

  const openWebsite = (url) => {
    if (url) {
      Linking.openURL(url);
    }
  };

  const callPhone = (phone) => {
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    }
  };

  // NEW: Filter functions
  const getFilteredCombos = () => {
    let filtered = [...combos];

    // Filter by cuisine
    if (selectedCuisine !== 'all') {
      filtered = filtered.filter(combo => 
        combo.restaurant.cuisine.toLowerCase().includes(selectedCuisine.toLowerCase())
      );
    }

    // Filter by price level
    if (selectedPriceLevel !== 'all') {
      filtered = filtered.filter(combo => 
        combo.restaurant.priceLevel === selectedPriceLevel
      );
    }

    // Filter by minimum rating
    if (minRating > 0) {
      filtered = filtered.filter(combo => 
        combo.comboRating >= minRating
      );
    }

    // Filter by maximum distance
    filtered = filtered.filter(combo => 
      combo.distance <= (maxDistance / 1000)
    );

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'rating') {
        return b.comboRating - a.comboRating;
      } else if (sortBy === 'distance') {
        return a.distance - b.distance;
      }
      return 0;
    });

    return filtered;
  };

  const resetFilters = () => {
    setSelectedCuisine('all');
    setSelectedPriceLevel('all');
    setMinRating(0);
    setMaxDistance(2000);
    setSortBy('rating');
  };

  // Get unique cuisines from combos
  const getAvailableCuisines = () => {
    const cuisines = combos.map(c => c.restaurant.cuisine);
    return ['all', ...new Set(cuisines)];
  };

  // Render Functions
  const renderHome = () => (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>BestNight</Text>
        <Text style={styles.headerSubtitle}>Find your perfect dinner & drinks combo</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.locationSection}>
          <Text style={styles.sectionTitle}>Where are you?</Text>

          <TouchableOpacity
            style={styles.detectButton}
            onPress={handleLocationDetection}
            disabled={loading}
          >
            <Ionicons name="location" size={24} color="#ffffff" />
            <Text style={styles.detectButtonText}>
              {loading ? 'Detecting...' : 'Detect My Location'}
            </Text>
          </TouchableOpacity>

          {detectedLocation ? (
            <View style={styles.detectedLocation}>
              <Ionicons name="checkmark-circle" size={24} color="#065f46" />
              <Text style={styles.detectedLocationText}>{detectedLocation}</Text>
            </View>
          ) : null}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            style={styles.input}
            placeholder="Enter city or address"
            value={location}
            onChangeText={setLocation}
            onSubmitEditing={handleManualLocation}
          />

          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleManualLocation}
            disabled={loading || !location.trim()}
          >
            <Text style={styles.searchButtonText}>
              {loading ? 'Searching...' : 'Search Location'}
            </Text>
          </TouchableOpacity>

          {/* NEW: Find Locations Button */}
          {userCoords && (
            <TouchableOpacity
              style={styles.findLocationsButton}
              onPress={handleFindLocations}
              disabled={loading}
            >
              <Ionicons name="search" size={20} color="#ffffff" />
              <Text style={styles.findLocationsButtonText}>
                {loading ? 'Finding...' : 'Find Locations'}
              </Text>
            </TouchableOpacity>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={20} color="#dc2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.howItWorks}>
          <Text style={styles.howItWorksTitle}>How it works</Text>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>1</Text>
            </View>
            <Text style={styles.stepText}>Share your location or enter a city</Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>2</Text>
            </View>
            <Text style={styles.stepText}>Click "Find Locations" to search</Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>3</Text>
            </View>
            <Text style={styles.stepText}>Browse perfect dinner & drinks combos</Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>4</Text>
            </View>
            <Text style={styles.stepText}>Get directions and enjoy your night!</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );

  const renderResults = () => {
    const filteredCombos = getFilteredCombos();
    const displayCombos = filter === 'favorites' 
      ? filteredCombos.filter(c => favorites.includes(c.id))
      : filteredCombos;

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setScreen('home')}>
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Best Combos</Text>
            <Text style={styles.headerSubtitle}>{detectedLocation}</Text>
          </View>
          <TouchableOpacity onPress={() => setShowFilters(!showFilters)}>
            <Ionicons name="options" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* NEW: Filter Panel */}
        {showFilters && (
          <View style={styles.filterPanel}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {/* Cuisine Filter */}
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Cuisine</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {getAvailableCuisines().map(cuisine => (
                    <TouchableOpacity
                      key={cuisine}
                      style={[
                        styles.filterChip,
                        selectedCuisine === cuisine && styles.filterChipActive
                      ]}
                      onPress={() => setSelectedCuisine(cuisine)}
                    >
                      <Text style={[
                        styles.filterChipText,
                        selectedCuisine === cuisine && styles.filterChipTextActive
                      ]}>
                        {cuisine === 'all' ? 'All' : cuisine}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* Price Filter */}
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Price</Text>
                <View style={styles.filterChips}>
                  {['all', '£', '££', '£££', '££££'].map(price => (
                    <TouchableOpacity
                      key={price}
                      style={[
                        styles.filterChip,
                        selectedPriceLevel === price && styles.filterChipActive
                      ]}
                      onPress={() => setSelectedPriceLevel(price)}
                    >
                      <Text style={[
                        styles.filterChipText,
                        selectedPriceLevel === price && styles.filterChipTextActive
                      ]}>
                        {price === 'all' ? 'All' : price}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Rating Filter */}
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Min Rating</Text>
                <View style={styles.filterChips}>
                  {[0, 3.5, 4.0, 4.5].map(rating => (
                    <TouchableOpacity
                      key={rating}
                      style={[
                        styles.filterChip,
                        minRating === rating && styles.filterChipActive
                      ]}
                      onPress={() => setMinRating(rating)}
                    >
                      <Text style={[
                        styles.filterChipText,
                        minRating === rating && styles.filterChipTextActive
                      ]}>
                        {rating === 0 ? 'Any' : `${rating}+`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Distance Filter */}
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Max Distance</Text>
                <View style={styles.filterChips}>
                  {[500, 1000, 2000, 5000].map(distance => (
                    <TouchableOpacity
                      key={distance}
                      style={[
                        styles.filterChip,
                        maxDistance === distance && styles.filterChipActive
                      ]}
                      onPress={() => setMaxDistance(distance)}
                    >
                      <Text style={[
                        styles.filterChipText,
                        maxDistance === distance && styles.filterChipTextActive
                      ]}>
                        {distance / 1000}km
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={styles.filterActions}>
              <TouchableOpacity 
                style={styles.resetFiltersButton}
                onPress={resetFilters}
              >
                <Text style={styles.resetFiltersText}>Reset All</Text>
              </TouchableOpacity>
              <Text style={styles.resultsCount}>
                {displayCombos.length} combo{displayCombos.length !== 1 ? 's' : ''} found
              </Text>
            </View>
          </View>
        )}

        <View style={styles.filterTabs}>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.filterTabText, filter === 'all' && styles.filterTabTextActive]}>
              All ({filteredCombos.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTab, filter === 'favorites' && styles.filterTabActive]}
            onPress={() => setFilter('favorites')}
          >
            <Ionicons 
              name="heart" 
              size={16} 
              color={filter === 'favorites' ? '#ec4899' : '#9ca3af'} 
            />
            <Text style={[styles.filterTabText, filter === 'favorites' && styles.filterTabTextActive]}>
              Favorites ({favorites.length})
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#ec4899" />
              <Text style={styles.loadingText}>Finding best combos...</Text>
            </View>
          ) : displayCombos.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="search" size={64} color="#d1d5db" />
              <Text style={styles.emptyStateTitle}>
                {filter === 'favorites' ? 'No favorites yet' : 'No combos found'}
              </Text>
              <Text style={styles.emptyStateText}>
                {filter === 'favorites' 
                  ? 'Start adding combos to your favorites!' 
                  : 'Try adjusting your filters or search area'}
              </Text>
              {filter !== 'favorites' && (
                <TouchableOpacity 
                  style={styles.showAllButton}
                  onPress={resetFilters}
                >
                  <Text style={styles.showAllButtonText}>Reset Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            displayCombos.map(combo => (
              <View key={combo.id} style={styles.comboCard}>
                <View style={styles.comboHeader}>
                  <View style={styles.comboBadge}>
                    <Text style={styles.comboBadgeText}>Perfect Match</Text>
                  </View>
                  <View style={styles.comboRating}>
                    <Ionicons name="star" size={16} color="#fbbf24" />
                    <Text style={styles.comboRatingText}>{combo.comboRating.toFixed(1)}</Text>
                  </View>
                </View>

                <Text style={styles.restaurantName}>{combo.restaurant.name}</Text>
                <View style={styles.restaurantMeta}>
                  <Text style={styles.restaurantRating}>⭐ {combo.restaurant.rating}</Text>
                  <Text style={styles.restaurantMetaText}>• {combo.restaurant.cuisine}</Text>
                  <Text style={styles.restaurantMetaText}>• {combo.restaurant.priceLevel}</Text>
                </View>

                <View style={styles.walkInfo}>
                  <Ionicons name="walk" size={20} color="#065f46" />
                  <Text style={styles.walkInfoText}>
                    <Text style={styles.boldText}>{combo.walkTime} min walk</Text> to{' '}
                    <Text style={styles.boldText}>{combo.bar.name}</Text>
                  </Text>
                </View>

                <View style={styles.features}>
                  {combo.bar.features.map((feature, idx) => (
                    <View key={idx} style={styles.featureTag}>
                      <Text style={styles.featureText}>{feature}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.comboActions}>
                  <TouchableOpacity
                    style={styles.viewDetailsButton}
                    onPress={() => handleComboSelect(combo)}
                  >
                    <Text style={styles.viewDetailsButtonText}>View Details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.mapButton}
                    onPress={() => openInMaps(combo.restaurant.coords, combo.restaurant.name)}
                  >
                    <Ionicons name="map" size={20} color="#374151" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.mapButton}
                    onPress={() => toggleFavorite(combo.id)}
                  >
                    <Ionicons
                      name={favorites.includes(combo.id) ? 'heart' : 'heart-outline'}
                      size={20}
                      color={favorites.includes(combo.id) ? '#ec4899' : '#374151'}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  };

  const renderDetails = () => {
    if (!selectedCombo) return null;

    const isFavorite = favorites.includes(selectedCombo.id);

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.detailsHeader}>
          <TouchableOpacity
            style={styles.detailsBackButton}
            onPress={() => setScreen('results')}
          >
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.favoriteButton}
            onPress={() => toggleFavorite(selectedCombo.id)}
          >
            <Ionicons
              name={isFavorite ? 'heart' : 'heart-outline'}
              size={24}
              color="#ffffff"
            />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.detailsContent}>
            <View style={styles.detailsTop}>
              <Text style={styles.detailsTitle}>{selectedCombo.restaurant.name}</Text>
              <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                <Ionicons name="share-social" size={20} color="#374151" />
              </TouchableOpacity>
            </View>

            <View style={styles.ratingRow}>
              <Ionicons name="star" size={20} color="#fbbf24" />
              <Text style={styles.detailsRating}>{selectedCombo.restaurant.rating}</Text>
              <Text style={styles.detailsReviews}>({selectedCombo.restaurant.reviews} reviews)</Text>
            </View>

            <Text style={styles.detailsMeta}>
              {selectedCombo.restaurant.cuisine} • {selectedCombo.restaurant.priceLevel}
            </Text>

            <View style={styles.comboBadgeBox}>
              <View style={styles.comboBadgeCircle}>
                <Text style={styles.comboBadgeNumber}>{selectedCombo.comboRating.toFixed(1)}</Text>
              </View>
              <View>
                <Text style={styles.comboBadgeTitle}>Perfect Match</Text>
                <Text style={styles.comboBadgeSubtitle}>Combo Rating</Text>
              </View>
            </View>

            <View style={styles.nextVenue}>
              <Text style={styles.nextVenueTime}>
                AFTER DINNER • {selectedCombo.walkTime} MIN WALK
              </Text>
              <Text style={styles.nextVenueName}>{selectedCombo.bar.name}</Text>
              <View style={styles.nextVenueRating}>
                <Ionicons name="star" size={16} color="#fbbf24" />
                <Text style={styles.nextVenueRatingText}>{selectedCombo.bar.rating}</Text>
                <Text style={styles.nextVenueReviews}>({selectedCombo.bar.reviews} reviews)</Text>
              </View>
              <View style={styles.nextVenueFeatures}>
                {selectedCombo.bar.features.map((feature, idx) => (
                  <View key={idx} style={styles.nextVenueFeatureTag}>
                    <Text style={styles.nextVenueFeatureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.detailsInfo}>
              <TouchableOpacity
                style={styles.infoRow}
                onPress={() => openInMaps(selectedCombo.restaurant.coords, selectedCombo.restaurant.name)}
              >
                <Ionicons name="location" size={24} color="#065f46" />
                <View style={styles.infoText}>
                  <Text style={styles.infoTitle}>Restaurant Location</Text>
                  <Text style={styles.infoSubtitle}>{selectedCombo.restaurant.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.infoRow}
                onPress={() => openInMaps(selectedCombo.bar.coords, selectedCombo.bar.name)}
              >
                <Ionicons name="location" size={24} color="#3b82f6" />
                <View style={styles.infoText}>
                  <Text style={styles.infoTitle}>Bar Location</Text>
                  <Text style={styles.infoSubtitle}>{selectedCombo.bar.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
              </TouchableOpacity>

              {selectedCombo.restaurant.phone && (
                <TouchableOpacity
                  style={styles.infoRow}
                  onPress={() => callPhone(selectedCombo.restaurant.phone)}
                >
                  <Ionicons name="call" size={24} color="#065f46" />
                  <View style={styles.infoText}>
                    <Text style={styles.infoTitle}>Call Restaurant</Text>
                    <Text style={styles.infoSubtitle}>{selectedCombo.restaurant.phone}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                </TouchableOpacity>
              )}

              {selectedCombo.bar.phone && (
                <TouchableOpacity
                  style={styles.infoRow}
                  onPress={() => callPhone(selectedCombo.bar.phone)}
                >
                  <Ionicons name="call" size={24} color="#3b82f6" />
                  <View style={styles.infoText}>
                    <Text style={styles.infoTitle}>Call Bar</Text>
                    <Text style={styles.infoSubtitle}>{selectedCombo.bar.phone}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.actionButtonPrimary}
                onPress={() => openInMaps(selectedCombo.restaurant.coords, selectedCombo.restaurant.name)}
              >
                <Text style={styles.actionButtonPrimaryText}>Start Navigation</Text>
              </TouchableOpacity>

              {selectedCombo.restaurant.website && (
                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  onPress={() => openWebsite(selectedCombo.restaurant.website)}
                >
                  <Text style={styles.actionButtonSecondaryText}>View Restaurant Website</Text>
                </TouchableOpacity>
              )}

              {selectedCombo.bar.website && (
                <TouchableOpacity
                  style={styles.actionButtonOutline}
                  onPress={() => openWebsite(selectedCombo.bar.website)}
                >
                  <Text style={styles.actionButtonOutlineText}>View Bar Website</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.actionButtonBlue}
                onPress={handleShare}
              >
                <Text style={styles.actionButtonBlueText}>Share This Combo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  };

  // Main render
  return (
    <>
      {screen === 'home' && renderHome()}
      {screen === 'results' && renderResults()}
      {screen === 'details' && renderDetails()}
    </>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    backgroundColor: '#ec4899',
    paddingTop: Platform.OS === 'ios' ? 0 : StatusBar.currentHeight,
    paddingHorizontal: 20,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#ffffff',
    opacity: 0.9,
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  locationSection: {
    padding: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  detectButton: {
    backgroundColor: '#ec4899',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  detectButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  detectedLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  detectedLocationText: {
    fontSize: 14,
    color: '#065f46',
    fontWeight: '500',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  dividerText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  searchButton: {
    backgroundColor: '#065f46',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  findLocationsButton: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  findLocationsButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#dc2626',
    fontSize: 14,
  },
  howItWorks: {
    padding: 24,
    backgroundColor: '#f9fafb',
  },
  howItWorksTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  stepNumber: {
    width: 32,
    height: 32,
    backgroundColor: '#ec4899',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
  },
  filterPanel: {
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 12,
  },
  filterGroup: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  filterChips: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#ec4899',
    borderColor: '#ec4899',
  },
  filterChipText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  filterActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  resetFiltersButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  resetFiltersText: {
    color: '#ec4899',
    fontWeight: '600',
    fontSize: 14,
  },
  resultsCount: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  filterTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  filterTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  filterTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#ec4899',
  },
  filterTabText: {
    fontSize: 14,
    color: '#9ca3af',
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: '#ec4899',
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 48,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 48,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  showAllButton: {
    backgroundColor: '#ec4899',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  showAllButtonText: {
    color: '#ffffff',
    fontWeight: '500',
  },
  comboCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  comboHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  comboBadge: {
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  comboBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#065f46',
  },
  comboRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  comboRatingText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  restaurantName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  restaurantMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  restaurantRating: {
    fontWeight: '500',
    fontSize: 14,
  },
  restaurantMetaText: {
    fontSize: 14,
    color: '#6b7280',
  },
  walkInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  walkInfoText: {
    flex: 1,
    fontSize: 14,
    color: '#374151',
  },
  boldText: {
    fontWeight: 'bold',
  },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 16,
  },
  featureTag: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  featureText: {
    fontSize: 12,
    color: '#1e40af',
  },
  comboActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewDetailsButton: {
    flex: 1,
    backgroundColor: '#065f46',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  viewDetailsButtonText: {
    color: '#ffffff',
    fontWeight: '500',
  },
  mapButton: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  // Details Screen Styles
  detailsHeader: {
    height: 150,
    backgroundColor: '#ec4899',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 24,
  },
  detailsBackButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 8,
    borderRadius: 24,
  },
  favoriteButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 8,
    borderRadius: 24,
  },
  detailsContent: {
    padding: 24,
  },
  detailsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  detailsTitle: {
    flex: 1,
    fontSize: 28,
    fontWeight: 'bold',
  },
  shareButton: {
    padding: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailsRating: {
    fontSize: 20,
    fontWeight: '600',
  },
  detailsReviews: {
    fontSize: 16,
    color: '#6b7280',
  },
  detailsMeta: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 24,
  },
  comboBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  comboBadgeCircle: {
    width: 48,
    height: 48,
    backgroundColor: '#065f46',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  comboBadgeNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  comboBadgeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#064e3b',
  },
  comboBadgeSubtitle: {
    fontSize: 14,
    color: '#065f46',
  },
  nextVenue: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  nextVenueTime: {
    fontSize: 14,
    color: '#065f46',
    fontWeight: '500',
    marginBottom: 12,
  },
  nextVenueName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  nextVenueRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  nextVenueRatingText: {
    fontSize: 16,
    fontWeight: '600',
  },
  nextVenueReviews: {
    fontSize: 14,
    color: '#6b7280',
  },
  nextVenueFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  nextVenueFeatureTag: {
    backgroundColor: '#bbf7d0',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  nextVenueFeatureText: {
    fontSize: 14,
    color: '#065f46',
    fontWeight: '500',
  },
  detailsInfo: {
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  actionButtons: {
    gap: 12,
  },
  actionButtonPrimary: {
    backgroundColor: '#065f46',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonPrimaryText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  actionButtonSecondary: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonSecondaryText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  actionButtonOutline: {
    borderColor: '#065f46',
    borderWidth: 2,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonOutlineText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#065f46',
  },
  actionButtonBlue: {
    borderColor: '#3b82f6',
    borderWidth: 2,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButtonBlueText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1e40af',
  },
});

export default BestNightApp;
