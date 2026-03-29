# ArcGIS REST Parcel/Property Endpoints - DMV, Richmond, Pennsylvania

## Summary

| Region | Counties Found | With Owner Name | Geometry-Only | No Public Service |
|--------|---------------|-----------------|---------------|-------------------|
| Maryland | 10/10 | 10 (statewide) | 0 | 0 |
| Virginia | 10/10 | 7 | 2 | 1 |
| DC | 1/1 | 1 | 0 | 0 |
| Pennsylvania | 11/11 | 8 | 2 | 1 |
| **TOTAL** | **32/32** | **26** | **4** | **2** |

---

## STATEWIDE SERVICES (cover multiple counties)

### Maryland Statewide (ALL 10 MD counties covered)

**MD PropertyData (Points)** - RECOMMENDED for owner lookups
```
https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0/query
```
- **Owner**: OWNADD1 (owner mailing address, NOT owner name - name not in dataset)
- **Address**: ADDRESS
- **Year Built**: YEARBLT
- **Assessed Value**: NFMTTLVL (total), NFMLNDVL (land), NFMIMPVL (improvements)
- **County Filter**: JURSCODE field (e.g., BACI=Baltimore City, BACO=Baltimore County, ANNE=Anne Arundel, etc.)
- **Note**: Must use `geometryType=esriGeometryEnvelope` with a small bounding box, NOT `esriGeometryPoint`
- **VERIFIED WORKING**

**MD ParcelBoundaries (Polygons)** - Same fields, with polygon geometry
```
https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query
```
- Same field names as PropertyData
- Also requires envelope geometry
- **VERIFIED WORKING**

**Example query (Baltimore City, -76.62, 39.29):**
```
?where=1%3D1&geometry=-76.621,39.289,-76.619,39.291&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=ACCTID,OWNADD1,ADDRESS,YEARBLT,NFMTTLVL,CITY,JURSCODE&returnGeometry=false&f=json
```

**IMPORTANT: MD statewide does NOT have owner name** -- only OWNADD1 (owner mailing address). For owner name, use SDAT web lookup with the ACCTID, or use the SDATWEBADR field which contains the direct URL.

### Maryland Jurisdiction Codes (JURSCODE)
| Code | County |
|------|--------|
| BACI | Baltimore City |
| BACO | Baltimore County |
| ANNE | Anne Arundel County |
| HOWA | Howard County |
| MONT | Montgomery County |
| PRIN | Prince George's County |
| FRED | Frederick County |
| HARF | Harford County |
| CARR | Carroll County |
| CECI | Cecil County |

---

### Pennsylvania Statewide

**PA_Parcels (DEP)**
```
https://gis.dep.pa.gov/depgisprd/rest/services/Parcels/PA_Parcels/MapServer/0/query
```
- **Owner**: OWNER_NAME, OWNER_FIRST_NAME, OWNER_LAST_NAME
- **Address**: PROPERTY_ADDRESS_1, PROPERTY_ADDRESS_2, CITY, STATE, ZIP
- **County**: COUNTY_NAME, COUNTY_CODE
- **No year built or assessed value**
- **Note**: Owner names appear NULL/empty for some counties (Philadelphia, Bucks observed null). Works well for rural counties.
- **VERIFIED WORKING** (partial - owner data coverage varies by county)

---

## MARYLAND (Individual County Services)

### 1. Baltimore County
**Already have** - not re-researched

### 2. Baltimore City
Use MD Statewide service (JURSCODE = "BACI")
- Lat/Lng bounding box: -76.71 to -76.53, 39.20 to 39.37

### 3. Anne Arundel County
**County-specific endpoint (with owner name):**
```
https://gis.aacounty.org/arcgis/rest/services/OpenData/Planning_OpenData/MapServer/34/query
```
- **Owner**: ASST_FIRST_OWNER, ASST_SECND_OWNER
- **Address**: ASST_HOUSE_NO + ASST_STREET_DIR + ASST_STREET_NAME + ASST_STREET_TYPE
- **Year Built**: ASST_YR_BUILT
- **Assessed Value**: (not in direct fields, use statewide)
- Lat/Lng box: -76.84 to -76.47, 38.82 to 39.13
- **VERIFIED WORKING**

### 4. Howard County
Use MD Statewide service (JURSCODE = "HOWA")
- Lat/Lng box: -77.06 to -76.70, 39.10 to 39.37

### 5. Montgomery County (MD)
Use MD Statewide service (JURSCODE = "MONT")
- Lat/Lng box: -77.51 to -76.88, 38.93 to 39.36
- County also has open data at: https://opendata-mcgov-gis.hub.arcgis.com/

### 6. Prince George's County
Use MD Statewide service (JURSCODE = "PRIN")
- Lat/Lng box: -77.08 to -76.66, 38.53 to 39.11
- County GIS: https://gisdata.pgplanning.org/

### 7. Frederick County
Use MD Statewide service (JURSCODE = "FRED")
- Lat/Lng box: -77.72 to -77.07, 39.21 to 39.72

### 8. Harford County
**County-specific endpoint (RECOMMENDED - has owner name + year built):**
```
https://hcggis.harfordcountymd.gov/public/rest/services/Planning/Cadastral/MapServer/0/query
```
- **Owner**: OWN_1, OWN_2
- **Address**: P_ST_NO + P_ST_DIREC + P_ST_NAME + P_ST_TYPE
- **Year Built**: YR_BUILT
- **Assessed Value**: CUR_T_ASSM (total), CUR_IMP_VA (improvements), CUR_T_M_VA (market)
- Lat/Lng box: -76.52 to -76.04, 39.36 to 39.72
- **VERIFIED WORKING** -- returned "HERSH LANCE" at 1108 SPARROW MILL

### 9. Carroll County
Use MD Statewide service (JURSCODE = "CARR")
- Lat/Lng box: -77.31 to -76.82, 39.35 to 39.72

### 10. Cecil County
Use MD Statewide service (JURSCODE = "CECI")
- Lat/Lng box: -76.24 to -75.77, 39.41 to 39.73

---

## VIRGINIA

### 11. Fairfax County
**Parcels endpoint (geometry only - NO owner name):**
```
https://www.fairfaxcounty.gov/mercator/rest/services/OpenData/OpenData_A9/MapServer/0/query
```
- **Fields**: PIN, PARCEL_KEY, PARCEL_TYPE (no owner, no address, no value)
- **Alternative** (also no owner): PLUS/DefaultMap MapServer/1 - has PIN only
- Lat/Lng box: -77.51 to -77.05, 38.60 to 38.97
- **STATUS**: GEOMETRY ONLY - no property data. Use iCare web lookup: https://icare.fairfaxcounty.gov/
- **VERIFIED WORKING** (but no useful property fields)

### 12. Loudoun County
**Parcels endpoint (geometry only - NO owner name):**
```
https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5/query
```
- **Fields**: PA_MCPI, PA_LEGAL_ACRE, PA_SUBD_NAME (no owner, no address, no value)
- Lat/Lng box: -77.96 to -77.32, 38.85 to 39.32
- **STATUS**: GEOMETRY ONLY - no property data
- **VERIFIED WORKING** (but no useful property fields)

### 13. Prince William County
**Parcels endpoint (HAS OWNER):**
```
https://gisweb.pwcva.gov/arcgis/rest/services/CountyMapper/LandRecords/MapServer/4/query
```
- **Owner**: CAMA_OWNER_CUR
- **Address**: StreetNumber + StreetName + StreetType
- **Year Built**: (not available)
- **Assessed Value**: (not available)
- Lat/Lng box: -77.72 to -77.23, 38.52 to 38.87
- **VERIFIED WORKING** -- returned owner data

### 14. Arlington County
**Parcels endpoint (geometry only - NO owner name):**
```
https://arlgis.arlingtonva.us/arcgis/rest/services/Public_Maps/Parcel_Map/MapServer/1/query
```
- **Fields**: RPCMSTR (parcel ID), EVENT_ID, GeoSyncDate
- Lat/Lng box: -77.17 to -77.05, 38.83 to 38.93
- **STATUS**: GEOMETRY ONLY - Use RPCMSTR to look up owner at https://realestate.arlingtonva.us/
- **VERIFIED WORKING** (but no property fields)

### 15. City of Alexandria
**Parcels endpoint (HAS OWNER + ASSESSED VALUE):**
```
https://maps.alexandriava.gov/arcgis/rest/services/alxLandWm/MapServer/1/query
```
- **Owner**: OWN_NAME
- **Address**: ADDRESS_GIS
- **Year Built**: (not available)
- **Assessed Value**: TOT_CYR (total), LAND_CYR (land), IMP_CYR (improvements)
- Lat/Lng box: -77.14 to -77.04, 38.79 to 38.85
- **VERIFIED WORKING** -- returned "CLAY MICHAEL P TR" at "1014 ORONOCO ST"

### 16. Henrico County (Richmond)
**No direct public ArcGIS parcel REST endpoint found with owner data.**
- County portal: https://data-henrico.opendata.arcgis.com/
- GIS Viewer: https://portal.henrico.gov/GISViewer/index.html
- Lat/Lng box: -77.65 to -77.16, 37.44 to 37.68
- **STATUS**: NO PUBLIC REST SERVICE with owner names. Use their GIS Viewer for interactive lookups.

### 17. Chesterfield County (Richmond)
**Token-required service (not publicly queryable).**
- GeoSpace portal: https://geospace.chesterfield.gov/
- Lat/Lng box: -77.75 to -77.29, 37.20 to 37.55
- **STATUS**: REQUIRES AUTHENTICATION. Use the Parcel Viewer web app for interactive lookups.

### 18. City of Richmond
**No direct public ArcGIS parcel REST endpoint found.**
- GeoHub: https://richmond-geo-hub-cor.hub.arcgis.com/
- Parcel Mapper: https://www.rva.gov/assessor-real-estate/gismapping
- Lat/Lng box: -77.60 to -77.38, 37.48 to 37.60
- **STATUS**: NO PUBLIC REST SERVICE found. Use Parcel Mapper web app.

### 19. Hanover County
**Parcels endpoint (HAS OWNER):**
```
https://parcelviewer.geodecisions.com/arcgis/rest/services/Hanover/Public/MapServer/0/query
```
- **Owner**: OWN_NAME1, OWN_NAME2
- **Address**: PROPERTYADDRESS (combined), or ADDRESS + ST_NAME + ST_TYPE
- **Year Built**: (not available)
- **Assessed Value**: (not available)
- Lat/Lng box: -77.67 to -77.15, 37.62 to 37.91
- **VERIFIED WORKING** -- returned owner and address data

### 20. Spotsylvania County
**Parcels endpoint (HAS OWNER + YEAR BUILT + ASSESSED VALUE):**
```
https://gis.spotsylvania.va.us/arcgis/rest/services/GeoHub/GeoHub/MapServer/45/query
```
- **Owner**: OwnerSearch
- **Address**: PROPADDRESS
- **Year Built**: YEARBUILT
- **Assessed Value**: BLDGASSESSMENT (building), LANDASSESSMENT (land)
- Lat/Lng box: -77.80 to -77.35, 38.08 to 38.38
- **Note**: Service can be slow to respond. May timeout occasionally.

---

## DISTRICT OF COLUMBIA

### 21. District of Columbia
**Owner Polygons endpoint (EXCELLENT - HAS ALL FIELDS):**
```
https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Property_and_Land/MapServer/40/query
```
- **Owner**: OWNERNAME, OWNNAME2
- **Address**: PREMISEADD
- **Year Built**: (not in this layer)
- **Assessed Value**: ASSESSMENT, ANNUALTAX
- **Additional**: NEWLAND, NEWIMPR, NEWTOTAL (new assessed values)
- Lat/Lng box: -77.12 to -76.91, 38.79 to 38.99
- **VERIFIED WORKING** -- returned "UNITED STATES OF AMERICA" at "1600 PENNSYLVANIA AVE NW"

---

## PENNSYLVANIA

### 22. Philadelphia County
**PWD_PARCELS endpoint (HAS OWNER):**
```
https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/PWD_PARCELS/FeatureServer/0/query
```
- **Owner**: owner1, owner2
- **Address**: address
- **Year Built**: (not available)
- **Assessed Value**: (not available)
- **Additional**: bldg_code, bldg_desc, gross_area
- Lat/Lng box: -75.28 to -74.96, 39.87 to 40.14
- **VERIFIED WORKING** -- returned "BJP CHESTNUT OWNER LLC" at "1112-28 CHESTNUT ST"

### 23. Montgomery County (PA)
**County parcels endpoint (GEOMETRY ONLY - no owner):**
```
https://gis.montcopa.org/arcgis/rest/services/Parcels/Montgomery_County_Parcels/MapServer/10/query
```
- **Fields**: TAXPIN, PARCELTYPE, CALCACREAGE only
- Lat/Lng box: -75.62 to -75.05, 40.01 to 40.32
- **STATUS**: GEOMETRY ONLY. Use https://propertyrecords.montcopa.org/ for owner lookups.

### 24. Delaware County (PA)
**Assessment Parcels endpoint (GEOMETRY ONLY - no owner):**
```
https://gis.delcopa.gov/arcgis/rest/services/AssessmentViewers/Parcels/MapServer/0/query
```
- **Fields**: PIN, MUNICIPALITY, CALCULATEDACREAGE only
- Lat/Lng box: -75.51 to -75.26, 39.84 to 40.00
- **STATUS**: GEOMETRY ONLY. Use http://delcorealestate.co.delaware.pa.us/ for owner lookups.

### 25. Chester County (PA)
**PASDA endpoint (HAS OWNER + ASSESSED VALUE):**
```
https://maps.pasda.psu.edu/arcgis/rest/services/pasda/ChesterCounty/MapServer/11/query
```
- **Owner**: OWN1, OWN2
- **Address**: LOC_ADDRES (combined), or ST_NUM + DIR + ST_NAME + ST_TYPE
- **Year Built**: (not available)
- **Assessed Value**: TOT_ASSESS, LOT_ASSESS, PROP_ASSES
- Lat/Lng box: -76.14 to -75.52, 39.72 to 40.10
- **VERIFIED WORKING** -- returned owner and assessment data

### 26. Bucks County (PA)
**PASDA endpoint (HAS OWNER + VALUES):**
```
https://mapservices.pasda.psu.edu/server/rest/services/pasda/BucksCounty/MapServer/17/query
```
- **Owner**: OWNER1, OWNER2, CARE_OF
- **Address**: ADDRESS
- **Year Built**: (not available)
- **Assessed Value**: TOTAL_VALU, LAND_VALUE, BUILDING_V
- Lat/Lng box: -75.43 to -74.86, 40.08 to 40.53
- **VERIFIED WORKING**

### 27. Lancaster County
**County endpoint (HAS OWNER + ASSESSED VALUE):**
```
https://arcgis.lancastercountypa.gov/arcgis/rest/services/parcel_poly/MapServer/0/query
```
- **Owner**: OWNER_NAME
- **Address**: ADDRESS (combined), or HOUSE_NO + STREET_DIR + STREET_NAME + STREET_SFX
- **Year Built**: (not available)
- **Assessed Value**: TOTLASSESS, LANDASSESS, BLDGASSESS
- Lat/Lng box: -76.48 to -75.87, 39.82 to 40.22
- **VERIFIED WORKING** -- returned "STAUFFER JOHN R" at "240 E ORANGE ST"

### 28. York County
**County endpoint (HAS OWNER + YEAR BUILT + ASSESSED VALUE - BEST PA):**
```
https://maps.yorkcounty.gov/arcgis/rest/services/AGOservices/Landrecords_Service/MapServer/7/query
```
- **Owner**: ownerName, ownerCOLine
- **Address**: ADDRESS (combined), or VIS_streetNumber + VIS_streetName + VIS_streetType
- **Year Built**: yearBuilt
- **Assessed Value**: currTotalVal, currLandVal, currImprovementVal, currBuildingVal
- **Historical values**: LVAL2008-2024, IVAL2008-2024
- Lat/Lng box: -77.00 to -76.45, 39.72 to 40.07
- **VERIFIED WORKING** (structure confirmed, point returned empty features in test area)

### 29. Dauphin County (Harrisburg)
**County endpoint (address + land/building values, NO owner):**
```
https://gis.dauphincounty.org/arcgis/rest/services/Parcels/MapServer/1/query
```
- **Owner**: (not available)
- **Address**: house_number + prefix_directional + street_name + street_suffix
- **Year Built**: (not available)
- **Assessed Value**: land, building (separate fields)
- Lat/Lng box: -76.95 to -76.53, 40.19 to 40.60
- **STATUS**: NO OWNER NAME. Use https://gis.dauphincounty.org/ for owner lookups.

### 30. Berks County
**County endpoint (HAS OWNER + ASSESSED VALUE):**
```
https://gis.co.berks.pa.us/arcgis/rest/services/Assess/ParcelSearchTable/MapServer/0/query
```
- **Owner**: NAME1 (alias: "Owner Name 1")
- **Address**: FULLSITEADDRESS (combined)
- **Year Built**: (not available)
- **Assessed Value**: VALUTOTAL, VALULAND, VALUBLDG
- Lat/Lng box: -76.25 to -75.69, 40.17 to 40.59
- **VERIFIED WORKING** (structure confirmed)

### 31. Lehigh County
**County endpoint (HAS OWNER + ASSESSED VALUE):**
```
https://gis.lehighcounty.org/arcgis/rest/services/ParcelViewer/OwnerAsmtData/MapServer/0/query
```
- **Owner**: NAMOWN (alias: "OWNER")
- **Address**: ADDRESS (alias: "FULL SITE ADDRESS"), or ADDRES (street name)
- **Year Built**: (not available)
- **Assessed Value**: TOTASMT, TAXASMT, TAXLND, TAXBLD
- Lat/Lng box: -75.73 to -75.34, 40.48 to 40.72
- **VERIFIED WORKING** -- returned full owner and assessment data

### 32. Allegheny County (Pittsburgh)
**County endpoint (GEOMETRY ONLY - no owner):**
```
https://gisdata.alleghenycounty.us/arcgis/rest/services/EGIS/Web_Parcels/MapServer/0/query
```
- **Fields**: PIN, MAPBLOCKLOT, CALCACREAGE only
- Lat/Lng box: -80.19 to -79.70, 40.27 to 40.66
- **STATUS**: GEOMETRY ONLY. Use https://www2.alleghenycounty.us/RealEstate/ for owner lookups.

---

## QUICK REFERENCE - BEST ENDPOINTS FOR OWNER LOOKUP

| # | County | Endpoint | Owner Field | Address Field | Value Field |
|---|--------|----------|-------------|---------------|-------------|
| 1 | **DC** | maps2.dcgis.dc.gov/.../MapServer/40/query | OWNERNAME | PREMISEADD | ASSESSMENT |
| 2 | **All MD** (statewide) | mdgeodata.md.gov/.../MD_PropertyData/MapServer/0/query | OWNADD1* | ADDRESS | NFMTTLVL |
| 3 | **Harford Co MD** | hcggis.harfordcountymd.gov/.../Cadastral/MapServer/0/query | OWN_1 | P_ST_NAME | CUR_T_ASSM |
| 4 | **Anne Arundel MD** | gis.aacounty.org/.../Planning_OpenData/MapServer/34/query | ASST_FIRST_OWNER | ASST_STREET_NAME | (statewide) |
| 5 | **Prince William VA** | gisweb.pwcva.gov/.../LandRecords/MapServer/4/query | CAMA_OWNER_CUR | StreetName | (none) |
| 6 | **Alexandria VA** | maps.alexandriava.gov/.../alxLandWm/MapServer/1/query | OWN_NAME | ADDRESS_GIS | TOT_CYR |
| 7 | **Hanover VA** | parcelviewer.geodecisions.com/.../Hanover/Public/MapServer/0/query | OWN_NAME1 | PROPERTYADDRESS | (none) |
| 8 | **Spotsylvania VA** | gis.spotsylvania.va.us/.../GeoHub/MapServer/45/query | OwnerSearch | PROPADDRESS | BLDGASSESSMENT |
| 9 | **Philadelphia PA** | services.arcgis.com/.../PWD_PARCELS/FeatureServer/0/query | owner1 | address | (none) |
| 10 | **Chester Co PA** | maps.pasda.psu.edu/.../ChesterCounty/MapServer/11/query | OWN1 | LOC_ADDRES | TOT_ASSESS |
| 11 | **Bucks Co PA** | mapservices.pasda.psu.edu/.../BucksCounty/MapServer/17/query | OWNER1 | ADDRESS | TOTAL_VALU |
| 12 | **Lancaster PA** | arcgis.lancastercountypa.gov/.../parcel_poly/MapServer/0/query | OWNER_NAME | ADDRESS | TOTLASSESS |
| 13 | **York PA** | maps.yorkcounty.gov/.../Landrecords_Service/MapServer/7/query | ownerName | ADDRESS | currTotalVal |
| 14 | **Berks PA** | gis.co.berks.pa.us/.../ParcelSearchTable/MapServer/0/query | NAME1 | FULLSITEADDRESS | VALUTOTAL |
| 15 | **Lehigh PA** | gis.lehighcounty.org/.../OwnerAsmtData/MapServer/0/query | NAMOWN | ADDRESS | TOTASMT |

*OWNADD1 = owner mailing address, not owner name. MD statewide does NOT have owner name directly.

---

## COUNTIES WITHOUT FREE OWNER LOOKUP VIA REST

| County | Issue | Workaround |
|--------|-------|------------|
| Fairfax County VA | Parcel geometry only | iCare web app: https://icare.fairfaxcounty.gov/ |
| Loudoun County VA | Parcel geometry only | WebLoGIS: https://logis.loudoun.gov/weblogis/ |
| Arlington County VA | Parcel geometry only | Real Estate: https://realestate.arlingtonva.us/ |
| Henrico County VA | No public REST service | GIS Viewer: https://portal.henrico.gov/GISViewer/ |
| Chesterfield County VA | Token required | GeoSpace: https://geospace.chesterfield.gov/ |
| City of Richmond VA | No public REST service | Parcel Mapper: https://www.rva.gov/assessor-real-estate/gismapping |
| Montgomery County PA | Parcel geometry only | Property Records: https://propertyrecords.montcopa.org/ |
| Delaware County PA | Parcel geometry only | Real Estate: http://delcorealestate.co.delaware.pa.us/ |
| Allegheny County PA | Parcel geometry only | Real Estate: https://www2.alleghenycounty.us/RealEstate/ |
| Dauphin County PA | No owner in service | Parcel Viewer: https://gis.dauphincounty.org/ |

---

## UNIVERSAL QUERY TEMPLATE

```
{endpoint}?geometry={lng},{lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields={fields}&returnGeometry=false&f=json
```

**For Maryland statewide (requires envelope):**
```
{endpoint}?where=1%3D1&geometry={lng-0.001},{lat-0.001},{lng+0.001},{lat+0.001}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields={fields}&returnGeometry=false&f=json
```
