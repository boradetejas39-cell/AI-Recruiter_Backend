const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function testConnection() {
    console.log('Testing connection to:', process.env.MONGODB_URI);
    const start = Date.now();
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`Connected in ${Date.now() - start}ms`);
        
        const User = mongoose.model('User', new mongoose.Schema({ email: String }));
        const findStart = Date.now();
        const user = await User.findOne({ email: 'non-existent-' + Date.now() });
        console.log(`Query finished in ${Date.now() - findStart}ms`);
        
        await mongoose.disconnect();
    } catch (err) {
        console.error('Connection failed:', err.message);
    }
}

testConnection();
