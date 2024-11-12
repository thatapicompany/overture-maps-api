import { parseMultiPolygonToGeoJSON, parsePolygonToGeoJSON, parseWKTToGeoJSON } from "./geojson";


const PolygonStr = "POLYGON((151.2762519003 -33.8915747100951, 151.276258302075 -33.8914594937271, 151.276189186945 -33.8914340614275, 151.276066105576 -33.8914671922852, 151.276054954362 -33.8914667647, 151.275981484004 -33.8914858830191, 151.275999470338 -33.8915335108494, 151.275962780589 -33.8915430560486, 151.275960784231 -33.8915789311803, 151.275923313259 -33.8915774943851, 151.275920283167 -33.8916319459681, 151.275975754972 -33.891634069767, 151.275983409999 -33.8916543402525, 151.275981862028 -33.8916821576985, 151.27603392474 -33.8916841540002, 151.276035202591 -33.8916611558307, 151.276077326459 -33.8916501944598, 151.276088482028 -33.891650622211, 151.276167145946 -33.8916301570429, 151.276169244963 -33.8915924371208, 151.276165426201 -33.8915823250443, 151.276215281919 -33.8915842367227, 151.2762519003 -33.8915747100951))"

const multiPolygonStr = `MULTIPOLYGON(((-73.9944007 40.7135703, -73.9943494 40.7134777, -73.9942995 40.7133877, -73.9938986 40.7135098, -73.993976 40.7136465, -73.9943661 40.7136157, -73.9943895 40.713585, -73.9944007 40.7135703)), ((-73.9942489 40.7132946, -73.9941596 40.7131396, -73.9941396 40.713141, -73.9941334 40.7131415, -73.9937179 40.713175, -73.9938473 40.7134172, -73.9942297 40.7133005, -73.9942489 40.7132946)))`

describe('GeoJSON tests', () => {
   

    it('should parse a valid MULTIPOLYGON string to GeoJSON', () => {
    
        try {
        const geoJSON = parseMultiPolygonToGeoJSON(multiPolygonStr);
        expect(geoJSON).toBeDefined();
        } catch (error) {
        console.error("Error parsing MULTIPOLYGON:", error.message);
        //fail
            expect(true).toBe(false);
        }

    });

    
    it('should parse a Polygon to GeoJSON', () => {

        try {
            const geoJSON = parsePolygonToGeoJSON(PolygonStr);
            expect(geoJSON).toBeDefined();
        } catch (error) {
        console.error("Error parsing MULTIPOLYGON:", error.message);
        //fail
            expect(true).toBe(false);
        }
    })

    it('should check that parseWKTToGeoJSON results in the correct GeoJSON type', () => {
        expect(parseWKTToGeoJSON(PolygonStr).type).toBe('Polygon');
    });
    
    it('should check that parseWKTToGeoJSON results in the correct GeoJSON type', () => {
        expect(parseWKTToGeoJSON(multiPolygonStr).type).toBe('MultiPolygon');
    });
})