/*

Expect string to be in format "POLYGON((151.2762519003 -33.8915747100951, 151.276258302075 -33.8914594937271, 151.276189186945 -33.8914340614275, 151.276066105576 -33.8914671922852, 151.276054954362 -33.8914667647, 151.275981484004 -33.8914858830191, 151.275999470338 -33.8915335108494, 151.275962780589 -33.8915430560486, 151.275960784231 -33.8915789311803, 151.275923313259 -33.8915774943851, 151.275920283167 -33.8916319459681, 151.275975754972 -33.891634069767, 151.275983409999 -33.8916543402525, 151.275981862028 -33.8916821576985, 151.27603392474 -33.8916841540002, 151.276035202591 -33.8916611558307, 151.276077326459 -33.8916501944598, 151.276088482028 -33.891650622211, 151.276167145946 -33.8916301570429, 151.276169244963 -33.8915924371208, 151.276165426201 -33.8915823250443, 151.276215281919 -33.8915842367227, 151.2762519003 -33.8915747100951))"

*/
import * as turf from '@turf/turf'
import { Feature, Point, Polygon } from 'geojson';
//import geojson 

export const parsePolygonToGeoJSON  = (polygon: string): Polygon => {
    try{
        if(polygon === undefined){
            return null;
        }
        let coordinates = polygon
            .replace('POLYGON((','')
            .replace('))','')
            .split(',')
            .map((c) => c.trim().split(' ').map((c) => {
     {
        let num = parseFloat(c);
        //temp code whilst investigate if some data is dirty as some coordinates are in unexpected brackets
        if(c.charAt(0) === '('){
            c = c.substring(1);
            num = parseFloat(c);
        }
        if(isNaN(num)){
            console.log('Coordinate is NaN', c);
        }
        return num
     }           
    }));

        //filter out any empty coordinates or where either coordinate is null
        coordinates = coordinates.filter((c) => c.length === 2 && c[0] !== null && c[1] !== null);
        
        //check first pair of coordinates and add it to the end if it is not the same
        if(coordinates[0][0] !== coordinates[coordinates.length-1][0] || coordinates[0][1] !== coordinates[coordinates.length-1][1]){
            coordinates.push(coordinates[0]);
        }
        return {
            type: 'Polygon',
            coordinates: [coordinates]
        };
    }catch(e){
        console.log(e);
        return null;
    }
}

/*
export string of POINT(151.2772322 -33.8913828)
*/
export const parsePointToGeoJSON = (point: string): Point => {
    try{
        if(point === undefined){
            return null;
        }
        const coordinates = point
            .replace('POINT(','')
            .replace(')','')
            .split(' ')
            .map((c) => parseFloat(c));


        return {
            type: 'Point',
            coordinates: coordinates
        };
    }catch(e){
        console.log(e);
        return null;
    }
}

export const wrapAsGeoJSON = (features: any[] = []):any => { 
    
    //add a type: "Feature" to each building
    features.forEach((item: any) => {
        item.type = "Feature";
    });
    return {
      "type":"FeatureCollection",
      "features":   features

    };
}

export const isPointInPolygon = (point: Point|Polygon, polygon: Polygon): boolean => {

    if(point.type!="Point") {
        return false
      }
    return turf.booleanPointInPolygon(point, polygon);
}

export const isPointInPolygonWithoutTurf = (point: Point, polygon: Polygon): boolean => {
    const x = point.coordinates[0];
    const y = point.coordinates[1];
    const vs = polygon.coordinates[0];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0];
        const yi = vs[i][1];
        const xj = vs[j][0];
        const yj = vs[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi) / (yj - yi)) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

  export const   findNearestPolygon = (point: Point, polygons: Polygon[], maxAllowedDistance:number=100): Polygon | null => {
    let nearestPolygon: Polygon| null = null;
    let minDistance = Infinity;
    
    for (const polygon of polygons) {
        // Calculate the centroid of the polygon
        const centroid = turf.centroid(polygon);
    
        // Calculate the distance from the point to the polygon's centroid
        const distance = turf.distance(point, centroid, { units: 'kilometers' });
    
        // Check if this is the nearest polygon so far
        if (distance < minDistance) {
            minDistance = distance;
            nearestPolygon = polygon;
        }
    }
    if (minDistance > maxAllowedDistance) {
        return null;
    }
    
    return nearestPolygon;
    }