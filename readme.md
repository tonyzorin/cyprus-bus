# Cyprus Bus Tracker

A system for tracking bus services across major cities in Cyprus using GTFS (General Transit Feed Specification) data.

## Overview

This application manages and tracks bus services across Cyprus by processing GTFS data from different cities. It provides tools for data management, updates, and backup operations.

## Cities and SIRI Codes

| City/Service    | SIRI Code |
|----------------|-----------|
| Limassol       | 6         |
| Pafos          | 2         |
| Famagusta      | 4         |
| Intercity      | 5         |
| Nicosia        | 9         |
| Larnaca        | 10        |
| Pame Express   | 11        |

## Data Management Tools

### Main Script: `update_db.js`

The application provides three main operations for managing GTFS data:

1. **Full GTFS Update**
   ```bash
   node update_db.js
   ```
   - Downloads fresh GTFS files from all cities
   - Creates/updates database tables
   - Imports all GTFS data
   - Generates routes_by_city mapping
   - Creates gtfs_import.sql backup file

2. **Generate SQL Backup**
   ```bash
   node update_db.js --sql
   ```
   - Generates gtfs_import.sql from current database state
   - Includes table creation SQL
   - Includes all data as INSERT statements

3. **Import from SQL Backup**
   ```bash
   node update_db.js --import-sql
   ```
   - Creates tables if they don't exist
   - Truncates all existing data
   - Imports data from gtfs_import.sql

## Database Schema

The system uses the following tables to store GTFS data:

| Table Name      | Description                           |
|----------------|---------------------------------------|
| agency         | Transit agencies information           |
| calendar       | Service schedules                      |
| stops          | Bus stop locations and details         |
| shapes         | Route shape coordinates                |
| routes         | Bus route information                  |
| trips          | Individual trip schedules              |
| stop_times     | Stop arrival/departure times           |
| calendar_dates | Schedule exceptions                    |
| routes_by_city | Custom mapping of routes to cities     |

## Maintenance

- GTFS data should be updated periodically to ensure accurate route and schedule information
- The SQL backup feature provides a quick way to restore the database without downloading fresh GTFS files
- Regular backups are recommended before performing updates

## Contributing

For contributing to this project, please refer to our contributing guidelines [link to contributing.md if exists].

## License

[Add license information if applicable]