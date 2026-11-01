// Station update test utility
(function() {
  // Function to send a test update request to the server
  async function testStationUpdate() {
    const resultArea = document.getElementById('result');
    resultArea.innerHTML = "Testing station update...";

    const stationId = document.getElementById('stationId').value || 1;
    const stationName = document.getElementById('stationName').value || 'Test Station';
    const stationLocation = document.getElementById('stationLocation').value || 'Test Location';

    try {
      // Create token if missing
      if (!localStorage.getItem('coffee_system_token')) {
        localStorage.setItem('coffee_system_token', 'test_token_for_debugging');
      }

      // Log network request
      resultArea.innerHTML += "<p>Sending request to update station...</p>";
      console.log(`Sending PATCH request to update station ${stationId} with name: ${stationName}`);

      // Attempt direct fetch to the API
      const directUrl = `http://localhost:5001/api/stations/${stationId}`;
      resultArea.innerHTML += `<p>URL: ${directUrl}</p>`;

      // Make the request
      const response = await fetch(directUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('coffee_system_token')}`
        },
        mode: 'cors',
        body: JSON.stringify({
          name: stationName,
          location: stationLocation
        })
      });

      // Check response status
      resultArea.innerHTML += `<p>Response status: ${response.status} ${response.statusText}</p>`;

      // Process response data
      let responseData;
      try {
        responseData = await response.json();
        resultArea.innerHTML += `<p>Response data: <pre>${JSON.stringify(responseData, null, 2)}</pre></p>`;
      } catch (jsonError) {
        const textResponse = await response.text();
        resultArea.innerHTML += `<p>Could not parse JSON response. Raw response: <pre>${textResponse}</pre></p>`;
        throw new Error(`Invalid JSON response: ${jsonError.message}`);
      }

      if (response.ok) {
        resultArea.innerHTML += `<p class="success">Station update successful!</p>`;
      } else {
        resultArea.innerHTML += `<p class="error">Error updating station: ${responseData.error || 'Unknown error'}</p>`;
      }
    } catch (error) {
      resultArea.innerHTML += `<p class="error">Request failed: ${error.message}</p>`;
      console.error('Station update test failed:', error);
    }
  }

  // Function to check if server is reachable
  async function checkServerStatus() {
    const statusArea = document.getElementById('server-status');
    statusArea.innerHTML = "Checking server status...";

    try {
      const response = await fetch('http://localhost:5001/api/auth-test', {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
      });

      if (response.ok) {
        statusArea.innerHTML = `<span class="success">Server is reachable (Status: ${response.status})</span>`;
      } else {
        statusArea.innerHTML = `<span class="warning">Server returned error status: ${response.status} ${response.statusText}</span>`;
      }
    } catch (error) {
      statusArea.innerHTML = `<span class="error">Cannot connect to server: ${error.message}</span>`;
      console.error('Server status check failed:', error);
    }
  }

  // Initialize the test page
  function init() {
    // Create the UI if it doesn't exist
    if (!document.getElementById('test-form')) {
      const container = document.createElement('div');
      container.id = 'station-test-container';
      container.innerHTML = `
        <h1>Station Update Test</h1>
        <div id="server-status">Server status: Unknown</div>
        <form id="test-form">
          <div class="form-group">
            <label for="stationId">Station ID:</label>
            <input type="number" id="stationId" value="1">
          </div>
          <div class="form-group">
            <label for="stationName">Station Name:</label>
            <input type="text" id="stationName" value="Station best">
          </div>
          <div class="form-group">
            <label for="stationLocation">Location:</label>
            <input type="text" id="stationLocation" value="north">
          </div>
          <button type="button" id="check-server">Check Server</button>
          <button type="button" id="test-update">Test Update</button>
        </form>
        <div id="result"></div>

        <style>
          #station-test-container {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
            border-radius: 8px;
          }
          .form-group {
            margin-bottom: 15px;
          }
          label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
          }
          input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
          }
          button {
            background: #0066cc;
            color: white;
            border: none;
            padding: 10px 15px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
          }
          #result {
            margin-top: 20px;
            padding: 15px;
            background: #fff;
            border-radius: 4px;
            border: 1px solid #ddd;
          }
          pre {
            background: #f1f1f1;
            padding: 10px;
            overflow: auto;
            border-radius: 4px;
          }
          .success { color: green; }
          .error { color: red; }
          .warning { color: orange; }
        </style>
      `;
      document.body.appendChild(container);

      // Add event listeners
      document.getElementById('test-update').addEventListener('click', testStationUpdate);
      document.getElementById('check-server').addEventListener('click', checkServerStatus);
    }

    // Check server status on page load
    checkServerStatus();
  }

  // Run the initialization when the page is loaded
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();