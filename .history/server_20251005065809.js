// Simple Express server to save hospital wait times snapshots
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

app.put('/api/hospital-wait-times', (req, res) => {
  const data = req.body;
  const filePath = path.join(__dirname, 'data', 'hospital_wait_times_snapshot.json');
  fs.writeFile(filePath, JSON.stringify(data, null, 2), err => {
    if (err) {
      console.error('Error saving hospital wait times:', err);
      return res.status(500).json({ error: 'Failed to save data.' });
    }
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
