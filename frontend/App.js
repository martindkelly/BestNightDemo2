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

const API_BASE_URL = 'https://backend-y4ec.onrender.com';

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
  const [showMenu, setShowMenu] = useState(false);
  
  const [maxDistanceFromUser, setMaxDistanceFromUser] = useState(5);
  const [minComboRating, setMinComboRating] = useState(0);
  const [maxWalkTime, setMaxWalkTime] = useState(15);
  
  const [selectedCuisine, setSelectedCuisine] = useState('all');
  const [selectedPriceLevel, setSelectedPriceLevel] = useState('all');

  useEffect(() => {
		AsyncStorage.clear();
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const saved = await AsyncStorage.getItem('bestnight_favorites');
      console.log('Loaded from AsyncStorage:', saved);
      if (saved && saved !== 'null' && saved !== 'undefined') {
        const parsed = JSON.parse(saved);
        console.log('Parsed favorites:', parsed);
        setFavorites(Array.isArray(parsed) ? parsed : []);
      } else {
        console.log('No saved favorites, setting to empty array');
        setFavorites([]);
      }
    } catch (e) {
      console.error('Failed to load favorites:', e);
      setFavorites([]);
    }
  };

  const saveFavorites = async (newFavorites) => {
    try {
      await AsyncStorage.setItem('bestnight_favorites', JSON.stringify(newFavorites));
    } catch (e) {
      console.error('Failed to save favorites:', e);
    }
  };

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
        throw new Error(errorData.error || 'Request failed');
      }

      return await response.json();
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  };

  const handleLocationDetection = async () => {
    setLoading(true);
    setError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        setError('Location permission denied');
        setLoading(false);
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        lat: currentLocation.coords.latitude,
        lng: currentLocation.coords.longitude,
      };

      setUserCoords(coords);

      const locationName = await reverseGeocode(coords);
      setDetectedLocation(locationName);

    } catch (err) {
      setError('Failed to get location. Try manual entry.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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

      } else {
        setError('Location not found');
      }
    } catch (err) {
      setError('Failed to find location');
    } finally {
      setLoading(false);
    }
  };

  const handleFindLocations = async () => {
    if (!userCoords) {
      setError('Please detect or enter a location first');
      return;
    }
    await fetchCombos(userCoords);
  };

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
        setError('No combos found. Try a different location.');
      }
    } catch (err) {
      console.error('Error fetching combos:', err);
      setError('Failed to fetch venues. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
      Alert.alert('Error', 'Failed to load details');
    } finally {
      setLoading(false);
    }
  };

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
      .map(formatType)
      .slice(0, 3);
  };

  const formatType = (type) => {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getPriceLevel = (level) => {
    if (!level) return '££';
    return '£'.repeat(level);
  };

  const toggleFavorite = (combo) => {
    const isFavorite = favorites.some(fav => fav.id === combo.id);
    let newFavorites;

    if (isFavorite) {
      newFavorites = favorites.filter(fav => fav.id !== combo.id);
    } else {
      newFavorites = [...favorites, combo];
    }

    setFavorites(newFavorites);
    saveFavorites(newFavorites);
  };

  const isFavorite = (combo) => {
    return favorites.some(fav => fav.id === combo.id);
  };

  const openMaps = (coords, name) => {
    const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
    const latLng = `${coords.lat},${coords.lng}`;
    const label = name;
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`
    });

    Linking.openURL(url);
  };

  const openDirections = (startCoords, endCoords) => {
    const url = Platform.select({
      ios: `maps:?saddr=${startCoords.lat},${startCoords.lng}&daddr=${endCoords.lat},${endCoords.lng}`,
      android: `google.navigation:q=${endCoords.lat},${endCoords.lng}`
    });

    Linking.openURL(url);
  };

  const shareCombo = async (combo) => {
    try {
      await Share.share({
        message: `Check out this night out combo:\n\n🍽️ ${combo.restaurant.name} (${combo.restaurant.rating}⭐)\n🍻 ${combo.bar.name} (${combo.bar.rating}⭐)\n\n${combo.walkTime} min walk between them!`,
        title: 'BestNight Combo'
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  };

  const callVenue = (phone) => {
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    } else {
      Alert.alert('Phone Not Available', 'No phone number for this venue');
    }
  };

  const openWebsite = (url) => {
    if (url) {
      Linking.openURL(url);
    } else {
      Alert.alert('Website Not Available', 'No website for this venue');
    }
  };

  const getFilteredCombos = () => {
    let filtered = [...combos];

    // cuisine filter
    if (selectedCuisine !== 'all') {
      filtered = filtered.filter(combo => 
        combo.restaurant.cuisine.toLowerCase() === selectedCuisine.toLowerCase()
      );
    }

    // price filter
    if (selectedPriceLevel !== 'all') {
      filtered = filtered.filter(combo => 
        combo.restaurant.priceLevel === selectedPriceLevel
      );
    }

    // rating filter
    if (minComboRating > 0) {
      filtered = filtered.filter(combo => combo.comboRating >= minComboRating);
    }

    // distance from user filter
    if (userCoords && maxDistanceFromUser < 50) {
      filtered = filtered.filter(combo => {
        const distToRestaurant = calculateDistanceKm(
          userCoords.lat,
          userCoords.lng,
          combo.restaurant.coords.lat,
          combo.restaurant.coords.lng
        );
        return distToRestaurant <= maxDistanceFromUser;
      });
    }

    // walk time filter
    if (maxWalkTime < 60) {
      filtered = filtered.filter(combo => combo.walkTime <= maxWalkTime);
    }

    // sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'rating':
          return b.comboRating - a.comboRating;
        case 'distance':
          return a.walkTime - b.walkTime;
        case 'restaurant':
          return b.restaurant.rating - a.restaurant.rating;
        case 'bar':
          return b.bar.rating - a.bar.rating;
        default:
          return 0;
      }
    });

    return filtered;
  };

  const calculateDistanceKm = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const getAvailableCuisines = () => {
    const cuisines = combos.map(combo => combo.restaurant.cuisine);
    return ['all', ...new Set(cuisines)];
  };

  // screens
  const renderHome = () => (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>BestNight</Text>
        <Text style={styles.subtitle}>Find your perfect dinner & drinks combo</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.locationSection}>
          <Text style={styles.sectionTitle}>Where are you?</Text>

          <TouchableOpacity 
            style={styles.detectButton} 
            onPress={handleLocationDetection}
            disabled={loading}
          >
            <Ionicons name="locate" size={20} color="#ffffff" />
            <Text style={styles.detectButtonText}>
              {loading ? 'Detecting...' : 'Detect My Location'}
            </Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            style={styles.input}
            placeholder="Enter city or address"
            value={location}
            onChangeText={setLocation}
            onSubmitEditing={handleManualLocation}
          />

          {detectedLocation && (
            <View style={styles.detectedLocationBox}>
              <Ionicons name="location" size={18} color="#065f46" />
              <Text style={styles.detectedLocationText}>{detectedLocation}</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color="#dc2626" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>

        <View style={styles.advancedOptions}>
          <TouchableOpacity 
            style={styles.advancedToggle}
            onPress={() => setShowFilters(!showFilters)}
          >
            <Text style={styles.advancedToggleText}>Advanced Options</Text>
            <Ionicons 
              name={showFilters ? "chevron-up" : "chevron-down"} 
              size={20} 
              color="#065f46" 
            />
          </TouchableOpacity>

          {showFilters && (
            <View style={styles.filtersContainer}>
              <View style={styles.filterItem}>
                <Text style={styles.filterLabel}>Search Radius: {searchRadius}m</Text>
                <View style={styles.radiusButtons}>
                  {[500, 1000, 2000, 5000].map(radius => (
                    <TouchableOpacity
                      key={radius}
                      style={[
                        styles.radiusButton,
                        searchRadius === radius && styles.radiusButtonActive
                      ]}
                      onPress={() => setSearchRadius(radius)}
                    >
                      <Text style={[
                        styles.radiusButtonText,
                        searchRadius === radius && styles.radiusButtonTextActive
                      ]}>
                        {radius}m
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.filterItem}>
                <Text style={styles.filterLabel}>
                  Max Distance: {maxDistanceFromUser === 50 ? 'Any' : `${maxDistanceFromUser}km`}
                </Text>
                <View style={styles.radiusButtons}>
                  {[1, 2, 5, 10, 50].map(dist => (
                    <TouchableOpacity
                      key={dist}
                      style={[
                        styles.radiusButton,
                        maxDistanceFromUser === dist && styles.radiusButtonActive
                      ]}
                      onPress={() => setMaxDistanceFromUser(dist)}
                    >
                      <Text style={[
                        styles.radiusButtonText,
                        maxDistanceFromUser === dist && styles.radiusButtonTextActive
                      ]}>
                        {dist === 50 ? 'Any' : `${dist}km`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.filterItem}>
                <Text style={styles.filterLabel}>
                  Min Rating: {minComboRating === 0 ? 'Any' : `${minComboRating}⭐`}
                </Text>
                <View style={styles.radiusButtons}>
                  {[0, 3.5, 4.0, 4.5].map(rating => (
                    <TouchableOpacity
                      key={rating}
                      style={[
                        styles.radiusButton,
                        minComboRating === rating && styles.radiusButtonActive
                      ]}
                      onPress={() => setMinComboRating(rating)}
                    >
                      <Text style={[
                        styles.radiusButtonText,
                        minComboRating === rating && styles.radiusButtonTextActive
                      ]}>
                        {rating === 0 ? 'Any' : `${rating}⭐`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.filterItem}>
                <Text style={styles.filterLabel}>
                  Max Walk: {maxWalkTime === 60 ? 'Any' : `${maxWalkTime}min`}
                </Text>
                <View style={styles.radiusButtons}>
                  {[5, 10, 15, 20, 60].map(time => (
                    <TouchableOpacity
                      key={time}
                      style={[
                        styles.radiusButton,
                        maxWalkTime === time && styles.radiusButtonActive
                      ]}
                      onPress={() => setMaxWalkTime(time)}
                    >
                      <Text style={[
                        styles.radiusButtonText,
                        maxWalkTime === time && styles.radiusButtonTextActive
                      ]}>
                        {time === 60 ? 'Any' : `${time}min`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity 
          style={[styles.searchButton, !userCoords && styles.searchButtonDisabled]}
          onPress={handleFindLocations}
          disabled={loading || !userCoords}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="search" size={20} color="#ffffff" />
              <Text style={styles.searchButtonText}>Find Locations</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.favoritesButton}
          onPress={() => setScreen('favorites')}
        >
          <Ionicons name="heart" size={20} color="#ec4899" />
          <Text style={styles.favoritesButtonText}>
            View Saved Combos ({favorites.length})
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderResults = () => {
    const filteredCombos = getFilteredCombos();
    const availableCuisines = getAvailableCuisines();

    return (
      <View style={styles.container}>
        <View style={styles.resultsHeader}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => setScreen('home')}
          >
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.resultsHeaderText}>
            <Text style={styles.resultsTitle}>{detectedLocation}</Text>
            <Text style={styles.resultsSubtitle}>
              {filteredCombos.length} {filteredCombos.length === 1 ? 'combo' : 'combos'} found
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.resultsContent}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#065f46" />
              <Text style={styles.loadingText}>Finding combos...</Text>
            </View>
          ) : filteredCombos.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="sad" size={48} color="#9ca3af" />
              <Text style={styles.emptyStateText}>No combos match your filters</Text>
              <TouchableOpacity 
                style={styles.resetButton}
                onPress={() => {
                  setSelectedCuisine('all');
                  setSelectedPriceLevel('all');
                  setMinComboRating(0);
                  setMaxWalkTime(60);
                  setMaxDistanceFromUser(50);
                }}
              >
                <Text style={styles.resetButtonText}>Reset Filters</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredCombos.map((combo, index) => (
              <View key={combo.id} style={styles.comboCard}>
                <View style={styles.comboHeader}>
                  <View style={styles.comboBadge}>
                    <Text style={styles.comboBadgeText}>#{index + 1}</Text>
                  </View>
                  <View style={styles.comboRating}>
                    <Ionicons name="star" size={16} color="#f59e0b" />
                    <Text style={styles.comboRatingText}>{combo.comboRating}</Text>
                  </View>
                </View>

                <Text style={styles.restaurantName}>{combo.restaurant.name}</Text>
                <View style={styles.restaurantMeta}>
                  <Text style={styles.restaurantRating}>⭐ {combo.restaurant.rating}</Text>
                  <Text style={styles.restaurantMetaText}>•</Text>
                  <Text style={styles.restaurantMetaText}>{combo.restaurant.cuisine}</Text>
                  <Text style={styles.restaurantMetaText}>•</Text>
                  <Text style={styles.restaurantMetaText}>{combo.restaurant.priceLevel}</Text>
                </View>

                <View style={styles.walkInfo}>
                  <Ionicons name="walk" size={18} color="#374151" />
                  <Text style={styles.walkInfoText}>
                    <Text style={styles.boldText}>{combo.walkTime} min walk</Text> to...
                  </Text>
                </View>

                <Text style={styles.restaurantName}>{combo.bar.name}</Text>
                <View style={styles.restaurantMeta}>
                  <Text style={styles.restaurantRating}>⭐ {combo.bar.rating}</Text>
                  <Text style={styles.restaurantMetaText}>•</Text>
                  <Text style={styles.restaurantMetaText}>
                    {combo.bar.reviews} reviews
                  </Text>
                </View>

                {combo.bar.features.length > 0 && (
                  <View style={styles.features}>
                    {combo.bar.features.map((feature, idx) => (
                      <View key={idx} style={styles.featureTag}>
                        <Text style={styles.featureText}>{feature}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.comboActions}>
                  <TouchableOpacity 
                    style={styles.viewDetailsButton}
                    onPress={() => handleComboSelect(combo)}
                  >
                    <Text style={styles.viewDetailsButtonText}>View Details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.mapButton}
                    onPress={() => openMaps(combo.restaurant.coords, combo.restaurant.name)}
                  >
                    <Ionicons name="map" size={20} color="#374151" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.mapButton}
                    onPress={() => toggleFavorite(combo)}
                  >
                    <Ionicons 
                      name={isFavorite(combo) ? "heart" : "heart-outline"} 
                      size={20} 
                      color={isFavorite(combo) ? "#ec4899" : "#374151"} 
                    />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  };

  const renderDetails = () => {
    if (!selectedCombo) return null;

    return (
      <ScrollView style={styles.container}>
        <View style={styles.detailsHeader}>
          <TouchableOpacity 
            style={styles.detailsBackButton}
            onPress={() => setScreen('results')}
          >
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.favoriteButton}
            onPress={() => toggleFavorite(selectedCombo)}
          >
            <Ionicons 
              name={isFavorite(selectedCombo) ? "heart" : "heart-outline"} 
              size={24} 
              color="#ffffff" 
            />
          </TouchableOpacity>
        </View>

        <View style={styles.detailsContent}>
          <View style={styles.detailsTop}>
            <Text style={styles.detailsTitle}>{selectedCombo.restaurant.name}</Text>
            <TouchableOpacity 
              style={styles.shareButton}
              onPress={() => shareCombo(selectedCombo)}
            >
              <Ionicons name="share-social" size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          <View style={styles.ratingRow}>
            <Ionicons name="star" size={20} color="#f59e0b" />
            <Text style={styles.detailsRating}>{selectedCombo.restaurant.rating}</Text>
            <Text style={styles.detailsReviews}>
              ({selectedCombo.restaurant.reviews} reviews)
            </Text>
          </View>

          <Text style={styles.detailsMeta}>
            {selectedCombo.restaurant.cuisine} • {selectedCombo.restaurant.priceLevel}
          </Text>

          <View style={styles.comboBadgeBox}>
            <View style={styles.comboBadgeCircle}>
              <Text style={styles.comboBadgeNumber}>{selectedCombo.comboRating}</Text>
            </View>
            <View>
              <Text style={styles.comboBadgeTitle}>Combo Rating</Text>
              <Text style={styles.comboBadgeSubtitle}>Great pairing!</Text>
            </View>
          </View>

          <View style={styles.nextVenue}>
            <Text style={styles.nextVenueTime}>
              🚶 {selectedCombo.walkTime} minute walk to...
            </Text>
            <Text style={styles.nextVenueName}>{selectedCombo.bar.name}</Text>
            <View style={styles.nextVenueRating}>
              <Ionicons name="star" size={18} color="#f59e0b" />
              <Text style={styles.nextVenueRatingText}>{selectedCombo.bar.rating}</Text>
              <Text style={styles.nextVenueReviews}>
                ({selectedCombo.bar.reviews} reviews)
              </Text>
            </View>
            {selectedCombo.bar.features.length > 0 && (
              <View style={styles.nextVenueFeatures}>
                {selectedCombo.bar.features.map((feature, idx) => (
                  <View key={idx} style={styles.nextVenueFeatureTag}>
                    <Text style={styles.nextVenueFeatureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.detailsInfo}>
            <View style={styles.infoRow}>
              <Ionicons name="time" size={24} color="#065f46" />
              <View style={styles.infoText}>
                <Text style={styles.infoTitle}>Hours (Restaurant)</Text>
                <Text style={styles.infoSubtitle}>{selectedCombo.restaurant.hours}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="location" size={24} color="#065f46" />
              <View style={styles.infoText}>
                <Text style={styles.infoTitle}>Address</Text>
                <Text style={styles.infoSubtitle}>{selectedCombo.restaurant.address}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="time" size={24} color="#3b82f6" />
              <View style={styles.infoText}>
                <Text style={styles.infoTitle}>Hours (Bar)</Text>
                <Text style={styles.infoSubtitle}>{selectedCombo.bar.hours}</Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="location" size={24} color="#3b82f6" />
              <View style={styles.infoText}>
                <Text style={styles.infoTitle}>Address</Text>
                <Text style={styles.infoSubtitle}>{selectedCombo.bar.address}</Text>
              </View>
            </View>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity 
              style={styles.actionButtonPrimary}
              onPress={() => openDirections(
                selectedCombo.restaurant.coords,
                selectedCombo.bar.coords
              )}
            >
              <Text style={styles.actionButtonPrimaryText}>Get Directions</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButtonSecondary}
              onPress={() => callVenue(selectedCombo.restaurant.phone)}
            >
              <Text style={styles.actionButtonSecondaryText}>
                Call Restaurant
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButtonSecondary}
              onPress={() => callVenue(selectedCombo.bar.phone)}
            >
              <Text style={styles.actionButtonSecondaryText}>Call Bar</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButtonOutline}
              onPress={() => openWebsite(selectedCombo.restaurant.website)}
            >
              <Text style={styles.actionButtonOutlineText}>Restaurant Website</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.actionButtonBlue}
              onPress={() => openWebsite(selectedCombo.bar.website)}
            >
              <Text style={styles.actionButtonBlueText}>Bar Website</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderFavorites = () => (
    <View style={styles.container}>
      <View style={styles.resultsHeader}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => setScreen('home')}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.resultsHeaderText}>
          <Text style={styles.resultsTitle}>Saved Combos</Text>
          <Text style={styles.resultsSubtitle}>{favorites.length} favorites</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.resultsContent}>
        {favorites.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={48} color="#9ca3af" />
            <Text style={styles.emptyStateText}>No saved combos yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Save combos by tapping the heart icon
            </Text>
          </View>
        ) : (
          favorites.map((combo, index) => (
            <View key={combo.id} style={styles.comboCard}>
              <View style={styles.comboHeader}>
                <View style={styles.comboBadge}>
                  <Text style={styles.comboBadgeText}>#{index + 1}</Text>
                </View>
                <View style={styles.comboRating}>
                  <Ionicons name="star" size={16} color="#f59e0b" />
                  <Text style={styles.comboRatingText}>{combo.comboRating}</Text>
                </View>
              </View>

              <Text style={styles.restaurantName}>{combo.restaurant.name}</Text>
              <View style={styles.restaurantMeta}>
                <Text style={styles.restaurantRating}>⭐ {combo.restaurant.rating}</Text>
                <Text style={styles.restaurantMetaText}>•</Text>
                <Text style={styles.restaurantMetaText}>{combo.restaurant.cuisine}</Text>
                <Text style={styles.restaurantMetaText}>•</Text>
                <Text style={styles.restaurantMetaText}>{combo.restaurant.priceLevel}</Text>
              </View>

              <View style={styles.walkInfo}>
                <Ionicons name="walk" size={18} color="#374151" />
                <Text style={styles.walkInfoText}>
                  <Text style={styles.boldText}>{combo.walkTime} min walk</Text> to...
                </Text>
              </View>

              <Text style={styles.restaurantName}>{combo.bar.name}</Text>
              <View style={styles.restaurantMeta}>
                <Text style={styles.restaurantRating}>⭐ {combo.bar.rating}</Text>
                <Text style={styles.restaurantMetaText}>•</Text>
                <Text style={styles.restaurantMetaText}>
                  {combo.bar.reviews} reviews
                </Text>
              </View>

              <View style={styles.comboActions}>
                <TouchableOpacity 
                  style={styles.viewDetailsButton}
                  onPress={() => {
                    setSelectedCombo(combo);
                    handleComboSelect(combo);
                  }}
                >
                  <Text style={styles.viewDetailsButtonText}>View Details</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.mapButton}
                  onPress={() => openMaps(combo.restaurant.coords, combo.restaurant.name)}
                >
                  <Ionicons name="map" size={20} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.mapButton}
                  onPress={() => toggleFavorite(combo)}
                >
                  <Ionicons name="heart" size={20} color="#ec4899" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      {screen === 'home' && renderHome()}
      {screen === 'results' && renderResults()}
      {screen === 'details' && renderDetails()}
      {screen === 'favorites' && renderFavorites()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#065f46',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    backgroundColor: '#065f46',
    padding: 32,
    paddingTop: 48,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#d1fae5',
  },
  content: {
    padding: 24,
  },
  locationSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  detectButton: {
    backgroundColor: '#065f46',
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#9ca3af',
    fontSize: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  detectedLocationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    gap: 8,
  },
  detectedLocationText: {
    flex: 1,
    color: '#065f46',
    fontSize: 14,
    fontWeight: '500',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#dc2626',
    fontSize: 14,
  },
  advancedOptions: {
    marginBottom: 24,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
  },
  advancedToggleText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#065f46',
  },
  filtersContainer: {
    marginTop: 16,
    gap: 16,
  },
  filterItem: {
    gap: 12,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  radiusButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  radiusButton: {
    flex: 1,
    padding: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
  },
  radiusButtonActive: {
    backgroundColor: '#065f46',
  },
  radiusButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  radiusButtonTextActive: {
    color: '#ffffff',
  },
  searchButton: {
    backgroundColor: '#ec4899',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
    marginBottom: 12,
  },
  searchButtonDisabled: {
    backgroundColor: '#d1d5db',
  },
  searchButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  favoritesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ec4899',
    gap: 8,
  },
  favoritesButtonText: {
    color: '#ec4899',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsHeader: {
    backgroundColor: '#065f46',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 20,
  },
  backButton: {
    padding: 8,
  },
  menuButton: {
    padding: 8,
  },
  resultsHeaderText: {
    flex: 1,
    alignItems: 'center',
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  resultsSubtitle: {
    fontSize: 14,
    color: '#d1fae5',
    marginTop: 2,
  },
  filterMenu: {
    backgroundColor: '#f9fafb',
    padding: 16,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  filterRow: {
    gap: 8,
  },
  filterMenuLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  filterOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  filterOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterOptionActive: {
    backgroundColor: '#065f46',
    borderColor: '#065f46',
  },
  filterOptionText: {
    fontSize: 14,
    color: '#374151',
  },
  filterOptionTextActive: {
    color: '#ffffff',
    fontWeight: '500',
  },
  resultsContent: {
    flex: 1,
    padding: 16,
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
  emptyStateText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
  },
  emptyStateSubtext: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  resetButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#065f46',
    borderRadius: 8,
  },
  resetButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  comboCard: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
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