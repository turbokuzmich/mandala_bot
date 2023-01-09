function getDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == lat2 && lon1 == lon2) {
    return 0;
  } else {
    const radlat1 = (Math.PI * lat1) / 180;
    const radlat2 = (Math.PI * lat2) / 180;
    const theta = lon1 - lon2;
    const radtheta = (Math.PI * theta) / 180;

    let dist =
      Math.sin(radlat1) * Math.sin(radlat2) +
      Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta);

    if (dist > 1) {
      dist = 1;
    }

    dist = Math.acos(dist);
    dist = (dist * 180) / Math.PI;
    dist = dist * 60 * 1.1515;

    return dist * 1.609344 * 1000;
  }
}

function getNearbyPoints({ latitude, longitude, points, distance }) {
  return points
    .reduce((points, point) => {
      const distanceToPoint = getDistance(
        latitude,
        longitude,
        point.latitude,
        point.longitude
      );

      return distanceToPoint > distance
        ? points
        : [...points, { point, distance: distanceToPoint }];
    }, [])
    .sort((pointA, pointB) => pointA.distance - pointB.distance);
}

function getNearbyListeners({ latitude, longitude, listeners }) {
  return Object.keys(listeners).filter(
    (id) =>
      getDistance(
        latitude,
        longitude,
        listeners[id].latitude,
        listeners[id].longitude
      ) <= listeners[id].distance
  );
}

export default function ({ type, ...params }) {
  if (type === "points") {
    return getNearbyPoints(params);
  } else if (type === "listeners") {
    return getNearbyListeners(params);
  }
}
