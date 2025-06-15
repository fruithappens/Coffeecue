# Guide: Generating Coffee Cue System Documentation

This guide explains how to generate and maintain documentation for the Coffee Cue system in both Excel and CSV formats. Future AI assistants should follow these guidelines to ensure consistent documentation.

## Documentation Purpose

The Coffee Cue documentation provides a comprehensive overview of the system architecture, helping both developers and AI assistants understand the structure, dependencies, and workflows of the application. This documentation is crucial for maintenance, troubleshooting, and extending the system.

## Documentation Formats

### Excel Format (Preferred)

The complete documentation is maintained in an Excel workbook with multiple worksheets. This is the preferred format as it allows for rich formatting, filtering, and relationships between elements.

To generate the Excel documentation:
1. Use the `generate-documentation.js` script in the project root
2. Run `node generate-documentation.js` after installing the ExcelJS library
3. The script produces `CoffeeCueSystemDocumentation.xlsx`

### CSV Format (For Version Control)

CSV files are used for version control-friendly documentation and are derived from the Excel worksheets. Each aspect of the system has its own CSV file.

## Required CSV Files

When documenting the Coffee Cue system, create the following CSV files:

### 1. file_components.csv

Documents all system files and their purpose:

```
FilePath,FileName,Purpose,Type,Dependencies,LastModified
src/components,BaristaInterface.js,Main barista dashboard UI,Component,"useOrders, OrderDataService, MessageService",2023-01-01
src/services,AuthService.js,Handles authentication with JWT,Service,OrderDataService,2023-01-01
...
```

### 2. frontend_architecture.csv

Maps React component relationships:

```
ComponentName,ParentComponent,FunctionClass,Props,StateManagement,APIEndpoints,RelatedFiles
BaristaInterface,App,Function Component,None,"useState, useOrders hook","/api/orders/*, /api/chat/messages","useOrders.js, OrderDataService.js"
PendingOrdersSection,BaristaInterface,Function Component,"orders, filter, onFilterChange, onStartOrder, onProcessBatch",Passed from parent,None (uses parent data),"VipOrdersList.js, BatchGroupsList.js"
...
```

### 3. backend_architecture.csv

Details Flask routes and handlers:

```
RouteName,HTTPMethod,EndpointPath,Controller,RequiredAuthRole,RequestParameters,ResponseStructure,DatabaseOperations
get_pending_orders,GET,/api/orders/pending,api_routes.py,"barista, admin",None,JSON array of order objects,SELECT from orders WHERE status=pending
start_order,POST,/api/orders/<order_id>/start,api_routes.py,"barista, admin",order_id (URL parameter),JSON success status,UPDATE orders SET status=in-progress
...
```

### 4. database_schema.csv

Documents database tables and columns:

```
TableName,ColumnName,DataType,Constraints,References,Purpose,RelatedModels
orders,id,SERIAL,PRIMARY KEY,,Unique identifier for orders,models/orders.py
orders,status,VARCHAR(20),NOT NULL,,Current order status,models/orders.py
users,username,VARCHAR(50),UNIQUE NOT NULL,,Login username,models/users.py
...
```

### 5. api_endpoints.csv

Lists all API endpoints:

```
Path,Method,Description,RequestFormat,ResponseFormat,AuthRequired,UsedBy
/api/orders/pending,GET,Get all pending orders,None,JSON Array of order objects,Yes - barista,PendingOrdersSection
/api/auth/login,POST,User login,"{'username': string, 'password': string}","{'token': string, 'refreshToken': string, 'user': object}",No,AuthService.login()
...
```

### 6. authentication_flow.csv

Documents authentication processes:

```
ProcessStep,FrontendComponent,BackendRoute,RequiredData,ResponseData,SecurityMeasures
User Login,LoginPage.jsx,/api/auth/login,"username, password","JWT token, refresh token, user object","Password hashing, HTTPS"
Token Storage,AuthService.js,N/A,"JWT token, refresh token",N/A,localStorage for tokens
...
```

### 7. user_workflows.csv

Describes step-by-step user scenarios:

```
WorkflowName,Actor,StepNumber,Action,FrontendComponent,BackendRoute,Notes
Process Order,Barista,1,View pending orders,PendingOrdersSection,/api/orders/pending,Lists all orders waiting to be prepared
Process Order,Barista,2,Start preparing an order,startOrder function,/api/orders/{id}/start,Moves order to in-progress status
...
```

### 8. dependencies.csv

Lists external packages:

```
PackageName,Version,Purpose,UsedBy,InstallationNotes,Alternatives
React,^18.2.0,Frontend UI library,All frontend components,npm install react react-dom,"Vue, Angular"
Flask,^2.0.0,Backend web framework,app.py and all routes,pip install Flask,"Django, FastAPI"
...
```

## How to Generate CSV Files

To convert from Excel to CSV:

1. **Automated Method**:
   ```javascript
   // convert-to-csv.js
   const ExcelJS = require('exceljs');
   const fs = require('fs');
   
   async function convertToCsv() {
     const workbook = new ExcelJS.Workbook();
     await workbook.xlsx.readFile('CoffeeCueSystemDocumentation.xlsx');
     
     workbook.worksheets.forEach(worksheet => {
       const name = worksheet.name.toLowerCase().replace(/\s+/g, '_');
       const rows = [];
       
       // Add header row
       const headerRow = [];
       worksheet.getRow(1).eachCell((cell) => {
         headerRow.push(cell.value);
       });
       rows.push(headerRow.join(','));
       
       // Add data rows
       worksheet.eachRow((row, rowNumber) => {
         if (rowNumber > 1) {  // Skip header
           const rowData = [];
           row.eachCell((cell) => {
             let value = cell.value;
             // Handle strings with commas
             if (typeof value === 'string' && value.includes(',')) {
               value = `"${value}"`;
             }
             rowData.push(value);
           });
           rows.push(rowData.join(','));
         }
       });
       
       fs.writeFileSync(`${name}.csv`, rows.join('\n'));
       console.log(`Created ${name}.csv`);
     });
   }
   
   convertToCsv().catch(err => console.error(err));
   ```

2. **Manual Method**:
   - Open the Excel file in Excel/Google Sheets/LibreOffice
   - For each worksheet, select "Save As" or "Export" and choose CSV format
   - Name each file according to the convention above

## Updating Documentation

When the system changes, documentation should be updated to reflect these changes:

1. **For minor updates**:
   - Directly edit the relevant CSV files
   - Run the Excel generation script to update the Excel file

2. **For major updates**:
   - Update the data in the `generate-documentation.js` script
   - Run the script to regenerate both Excel and CSV files

3. **Version control**:
   - Include a version number in each update
   - Add an entry to the version history sheet/CSV
   - Document major changes

## Guidelines for AI Assistants

When working with the Coffee Cue system:

1. Check the existing documentation first to understand system architecture
2. When modifying components, update the relevant documentation
3. Maintain consistent naming conventions and formatting
4. For new components, add entries following the established patterns
5. If you need to generate new documentation:
   - Use the `generate-documentation.js` script as a template
   - Ensure all required sheets/CSV files are created
   - Follow the column structure shown above

## Documentation Fields Explanation

### File Components
- **FilePath**: Directory location of the file
- **FileName**: Name of the file with extension
- **Purpose**: Brief description of what the file does
- **Type**: Category (Component, Service, Model, Route, etc.)
- **Dependencies**: Other files this file depends on
- **LastModified**: When the file was last changed

### Frontend Architecture
- **ComponentName**: Name of the React component
- **ParentComponent**: Component that contains this component
- **FunctionClass**: Whether it's a function or class component
- **Props**: Parameters passed to the component
- **StateManagement**: How state is managed (useState, useReducer, etc.)
- **APIEndpoints**: Backend endpoints used by the component
- **RelatedFiles**: Other files working with this component

### Backend Architecture
- **RouteName**: Name of the route function
- **HTTPMethod**: GET, POST, PUT, DELETE
- **EndpointPath**: URL path for the API endpoint
- **Controller**: File containing the route handler
- **RequiredAuthRole**: Authentication roles needed
- **RequestParameters**: Parameters expected in the request
- **ResponseStructure**: Format of the response
- **DatabaseOperations**: Database actions performed

Similar explanations should be applied to the other documentation categories.
