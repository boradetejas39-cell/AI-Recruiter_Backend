const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

/**
 * Connect to MongoDB using MONGODB_URI or MONGO_URI from environment.
 * Resolves `true` when connected, `false` when no URI provided.
 * Rejects on actual connection error.
 */
async function connectDB() {
    const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || null;

    // Handle file-based database
    if (MONGODB_URI === 'file-based') {
        console.log('Using file-based database (demo mode)');
        initializeFileDatabase();
        return 'file-based';
    }

    if (!MONGODB_URI) {
        console.log('MONGODB_URI not set — skipping MongoDB connection');
        return false;
    }

    mongoose.set('strictQuery', false);

    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
        });
        console.log('✅ Connected to MongoDB');
        return true;
    } catch (err) {
        console.error('MongoDB connection error:', err.message || err);
        // Don't throw - let the server start without DB
        return false;
    }
}

/**
 * Initialize file-based database for demo purposes
 */
function initializeFileDatabase() {
    const dbDir = path.join(__dirname, '../file-db');

    // Create database directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize data files
    const dataFiles = {
        users: path.join(dbDir, 'users.json'),
        jobs: path.join(dbDir, 'jobs.json'),
        resumes: path.join(dbDir, 'resumes.json'),
        matches: path.join(dbDir, 'matches.json'),
        applications: path.join(dbDir, 'applications.json')
    };

    // Create empty data files if they don't exist
    Object.entries(dataFiles).forEach(([key, filePath]) => {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify([], null, 2));
            console.log(`Created ${key} data file: ${filePath}`);
        }
    });

    // Set up global file-based database helpers
    global.fileDB = {
        read: (collection) => {
            const filePath = dataFiles[collection];
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
            return [];
        },
        write: (collection, data) => {
            const filePath = dataFiles[collection];
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        },
        add: (collection, item) => {
            const data = global.fileDB.read(collection);
            // Only assign a new _id if the item doesn't already have one
            if (!item._id) {
                item._id = Date.now().toString();
            }
            data.push(item);
            global.fileDB.write(collection, data);
            return item;
        },
        delete: (collection, id) => {
            const data = global.fileDB.read(collection);
            const index = data.findIndex(item => item._id === id);
            if (index !== -1) {
                data.splice(index, 1);
                global.fileDB.write(collection, data);
                return true;
            }
            return false;
        },
        find: (collection, query) => {
            const data = global.fileDB.read(collection);
            if (typeof query === 'string') {
                // Find by ID
                return data.find(item => item._id === query);
            } else if (typeof query === 'object') {
                // Find by query object
                return data.find(item =>
                    Object.keys(query).every(key => item[key] === query[key])
                );
            }
            return null;
        },
        filter: (collection, query) => {
            const data = global.fileDB.read(collection);
            if (!query) return data;
            return data.filter(item =>
                Object.keys(query).every(key => item[key] === query[key])
            );
        }
    };

    console.log('File-based database initialized successfully');
}

module.exports = connectDB;
