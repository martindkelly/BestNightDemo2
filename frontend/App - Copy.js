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

      // Fetch combos
      await fetchCombos(coords);
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

        await fetchCombos(coords);
      } else {
        setError('Location not found. Please try a different address.');
      }
    } catch (err) {
      setError('Failed to find location. Please try again.');
    } finally {
      setLoading(false);
    }
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
        message: `Check out this combo on BestNight: ${selectedCombo.restaurant.name} + ${selectedCombo.bar.name}`,
        title: 'BestNight Combo',
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const openInMaps = (coords, name) => {
    const scheme = Platform.select({
      ios: 'maps:0,0?q=',
      android: 'geo:0,0?q=',
    });
    const latLng = `${coords.lat},${coords.lng}`;
    const label = name;
    const url = Platform.select({
      ios: `${scheme}${label}@${latLng}`,
      android: `${scheme}${latLng}(${label})`,
    });

    Linking.openURL(url);
  };

  const getSortedCombos = () => {
    let sorted = [...combos];
    switch (sortBy) {
      case 'distance':
        return sorted.sort((a, b) => a.distanceKm - b.distanceKm);
      case 'rating':
        return sorted.sort((a, b) => b.comboRating - a.comboRating);
      case 'time':
        return sorted.sort((a, b) => a.walkTime - b.walkTime);
      default:
        return sorted;
    }
  };

  const getFilteredCombos = () => {
    const sorted = getSortedCombos();
    switch (filter) {
      case 'nearby':
        return sorted.filter(c => c.distanceKm <= 0.5);
      case 'topRated':
        return sorted.filter(c => c.comboRating >= 4.5);
      default:
        return sorted;
    }
  };

  // Loading Screen
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#065f46" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#065f46" />
          <Text style={styles.loadingText}>Finding the best combos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // HOME SCREEN
  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#065f46" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>BestNight</Text>
        </View>

        <ScrollView style={styles.content}>
          {error && (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={20} color="#dc2626" />
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => setError(null)}>
                <Text style={styles.dismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Where are you going?</Text>
            <Text style={styles.sectionSubtitle}>
              Find the perfect restaurant and bar combo nearby
            </Text>
          </View>

          <TouchableOpacity
            style={styles.locationButton}
            onPress={handleLocationDetection}
            disabled={loading}
          >
            <Ionicons name="location" size={24} color="#065f46" />
            <Text style={styles.locationButtonText}>Use my current location</Text>
          </TouchableOpacity>

          <Text style={styles.orText}>or</Text>

          <TextInput
            style={styles.input}
            placeholder="Enter address, venue or postcode"
            value={location}
            onChangeText={setLocation}
            onSubmitEditing={handleManualLocation}
          />

          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleManualLocation}
            disabled={loading || !location.trim()}
          >
            <Text style={styles.searchButtonText}>Search This Location</Text>
          </TouchableOpacity>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Search Radius: {searchRadius}m</Text>
            <Text style={styles.radiusSubtext}>({(searchRadius / 1000).toFixed(1)}km)</Text>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>• We find highly-rated restaurants and bars near you</Text>
            <Text style={styles.infoText}>• We pair them based on walkable distance</Text>
            <Text style={styles.infoText}>• You get the perfect night out combo!</Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleLocationDetection}
            disabled={loading}
          >
            <Text style={styles.primaryButtonText}>Find Combos</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // RESULTS SCREEN
  if (screen === 'results') {
    const filteredCombos = getFilteredCombos();

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <View style={styles.resultsHeader}>
          <TouchableOpacity onPress={() => setScreen('home')} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#000" />
          </TouchableOpacity>
          <View style={styles.resultsHeaderCenter}>
            <Text style={styles.resultsTitle}>Best Combos</Text>
            <Text style={styles.resultsSubtitle}>Within {detectedLocation}</Text>
            <Text style={styles.resultsCount}>{filteredCombos.length} combos found</Text>
          </View>
          <TouchableOpacity onPress={() => setShowFilters(!showFilters)}>
            <Ionicons name="options" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        <View style={styles.filterTabs}>
          {['all', 'nearby', 'topRated'].map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterTab, filter === f && styles.filterTabActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
                {f === 'all' ? 'All' : f === 'nearby' ? 'Nearby' : 'Top Rated'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {showFilters && (
          <View style={styles.sortOptions}>
            <Text style={styles.sortLabel}>Sort by:</Text>
            <View style={styles.sortButtons}>
              {['rating', 'distance', 'time'].map(sort => (
                <TouchableOpacity
                  key={sort}
                  style={[styles.sortButton, sortBy === sort && styles.sortButtonActive]}
                  onPress={() => setSortBy(sort)}
                >
                  <Text style={[styles.sortButtonText, sortBy === sort && styles.sortButtonTextActive]}>
                    {sort === 'time' ? 'Walk Time' : sort.charAt(0).toUpperCase() + sort.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <ScrollView style={styles.combosList}>
          {filteredCombos.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
              <Text style={styles.emptyText}>No combos found matching your filters.</Text>
              <TouchableOpacity
                style={styles.showAllButton}
                onPress={() => setFilter('all')}
              >
                <Text style={styles.showAllButtonText}>Show All Results</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredCombos.map(combo => (
              <View key={combo.id} style={styles.comboCard}>
                <View style={styles.comboHeader}>
                  <View style={styles.comboBadge}>
                    <Text style={styles.comboBadgeText}>Combo · {combo.distance} km</Text>
                  </View>
                  <View style={styles.comboRating}>
                    <Ionicons name="star" size={16} color="#fbbf24" />
                    <Text style={styles.comboRatingText}>{combo.comboRating}</Text>
                  </View>
                </View>

                <Text style={styles.restaurantName}>{combo.restaurant.name}</Text>
                <View style={styles.restaurantMeta}>
                  <Ionicons name="star" size={14} color="#fbbf24" />
                  <Text style={styles.restaurantRating}>{combo.restaurant.rating}</Text>
                  <Text style={styles.restaurantMetaText}>· {combo.restaurant.cuisine}</Text>
                  <Text style={styles.restaurantMetaText}>· {combo.restaurant.priceLevel}</Text>
                </View>

                <View style={styles.walkInfo}>
                  <Ionicons name="navigate" size={16} color="#4b5563" />
                  <Text style={styles.walkInfoText}>
                    {combo.walkTime} min walk to <Text style={styles.boldText}>{combo.bar.name}</Text>
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
                    onPress={() => openInMaps(combo.restaurant.coords, combo.restaurant.name)}
                  >
                    <Ionicons name="map" size={20} color="#4b5563" />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // DETAILS SCREEN
  if (screen === 'details' && selectedCombo) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#ec4899" />
        <ScrollView>
          <View style={styles.detailsHeader}>
            <TouchableOpacity
              onPress={() => setScreen('results')}
              style={styles.detailsBackButton}
            >
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => toggleFavorite(selectedCombo.id)}
              style={styles.favoriteButton}
            >
              <Ionicons
                name={favorites.includes(selectedCombo.id) ? 'bookmark' : 'bookmark-outline'}
                size={24}
                color="#fff"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.detailsContent}>
            <View style={styles.detailsTop}>
              <Text style={styles.detailsTitle}>{selectedCombo.restaurant.name}</Text>
              <TouchableOpacity onPress={handleShare} style={styles.shareButton}>
                <Ionicons name="share-social" size={20} color="#4b5563" />
              </TouchableOpacity>
            </View>

            <View style={styles.ratingRow}>
              <Ionicons name="star" size={20} color="#fbbf24" />
              <Text style={styles.detailsRating}>{selectedCombo.restaurant.rating}</Text>
              <Text style={styles.detailsReviews}>({selectedCombo.restaurant.reviews} reviews)</Text>
            </View>

            <Text style={styles.detailsMeta}>
              {selectedCombo.restaurant.cuisine} · {selectedCombo.restaurant.priceLevel} · {selectedCombo.distance} km
            </Text>

            <View style={styles.comboBadgeBox}>
              <View style={styles.comboBadgeCircle}>
                <Text style={styles.comboBadgeNumber}>{selectedCombo.comboRating}</Text>
              </View>
              <View>
                <Text style={styles.comboBadgeTitle}>Perfect Combo Pairing</Text>
                <Text style={styles.comboBadgeSubtitle}>Highly rated combination</Text>
              </View>
            </View>

            <View style={styles.nextVenue}>
              <Text style={styles.nextVenueTime}>
                {selectedCombo.walkTime} minute walk after dinner to:
              </Text>
              <Text style={styles.nextVenueName}>{selectedCombo.bar.name}</Text>
              <View style={styles.nextVenueRating}>
                <Ionicons name="star" size={18} color="#fbbf24" />
                <Text style={styles.nextVenueRatingText}>{selectedCombo.bar.rating}</Text>
                <Text style={styles.nextVenueReviews}>({selectedCombo.bar.reviews} reviews)</Text>
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
                <Ionicons name="time" size={20} color="#6b7280" />
                <View style={styles.infoText}>
                  <Text style={styles.infoTitle}>Restaurant Hours</Text>
                  <Text style={styles.infoSubtitle}>{selectedCombo.restaurant.hours}</Text>
                </View>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="location" size={20} color="#6b7280" />
                <View style={styles.infoText}>
                  <Text style={styles.infoTitle}>Location</Text>
                  <Text style={styles.infoSubtitle}>{selectedCombo.restaurant.location}</Text>
                </View>
              </View>
            </View>

            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={styles.actionButtonPrimary}
                onPress={() => openInMaps(selectedCombo.restaurant.coords, selectedCombo.restaurant.name)}
              >
                <Text style={styles.actionButtonPrimaryText}>Get Directions to Restaurant</Text>
              </TouchableOpacity>

              {selectedCombo.restaurant.phone && (
                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  onPress={() => Linking.openURL(`tel:${selectedCombo.restaurant.phone}`)}
                >
                  <Text style={styles.actionButtonSecondaryText}>Call Restaurant</Text>
                </TouchableOpacity>
              )}

              {selectedCombo.restaurant.website && (
                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  onPress={() => Linking.openURL(selectedCombo.restaurant.website)}
                >
                  <Text style={styles.actionButtonSecondaryText}>Visit Website</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.actionButtonOutline}
                onPress={() => toggleFavorite(selectedCombo.id)}
              >
                <Text style={styles.actionButtonOutlineText}>
                  {favorites.includes(selectedCombo.id) ? 'Remove from' : 'Save to'} Favourites
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionButtonOutline} onPress={handleShare}>
                <Text style={styles.actionButtonOutlineText}>Share Combo</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButtonBlue}
                onPress={() => openInMaps(selectedCombo.bar.coords, selectedCombo.bar.name)}
              >
                <Text style={styles.actionButtonBlueText}>Get Directions to Bar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    color: '#6b7280',
  },
  header: {
    backgroundColor: '#065f46',
    padding: 24,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  content: {
    flex: 1,
    padding: 24,
  },
  errorContainer: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    flex: 1,
    marginLeft: 12,
    color: '#991b1b',
    fontSize: 14,
  },
  dismissText: {
    color: '#dc2626',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 16,
    color: '#6b7280',
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  locationButtonText: {
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '500',
    color: '#065f46',
  },
  orText: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 16,
  },
  input: {
    borderColor: '#d1d5db',
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  searchButton: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginBottom: 32,
  },
  searchButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  radiusSubtext: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  infoBox: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
  },
  infoText: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 8,
  },
  primaryButton: {
    backgroundColor: '#065f46',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  // Results Screen Styles
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    padding: 8,
  },
  resultsHeaderCenter: {
    flex: 1,
    alignItems: 'center',
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  resultsSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  resultsCount: {
    fontSize: 12,
    color: '#9ca3af',
  },
  filterTabs: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
    backgroundColor: '#ffffff',
  },
  filterTab: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: '#f3f4f6',
  },
  filterTabActive: {
    backgroundColor: '#065f46',
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  filterTabTextActive: {
    color: '#ffffff',
  },
  sortOptions: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  sortLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  sortButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  sortButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
  },
  sortButtonActive: {
    backgroundColor: '#065f46',
  },
  sortButtonText: {
    fontSize: 14,
    color: '#374151',
  },
  sortButtonTextActive: {
    color: '#ffffff',
  },
  combosList: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  emptyState: {
    padding: 48,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 16,
  },
  showAllButton: {
    backgroundColor: '#065f46',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
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
