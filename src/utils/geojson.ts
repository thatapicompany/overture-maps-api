export const parsePolygonToGeoJSON  = (polygon: string): any => {
    const coordinates = polygon.split(' ').map((coord) => {
        const [lng, lat] = coord.split(',').map((c) => parseFloat(c));
        return [lng, lat];
    });
    return {
        type: 'Polygon',
        coordinates: [coordinates]
    };
}

export const parsePointToGeoJSON = (point: string): any => {
    const [lng, lat] = point.split(',').map((c) => parseFloat(c));
    return {
        type: 'Point',
        coordinates: [lng, lat]
    };
}