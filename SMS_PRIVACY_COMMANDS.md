# SMS Privacy Commands

Customers can manage their own data by texting these commands:

## Customer Commands

### View Your Data
- **MYDATA** - Receive a summary of your stored preferences
- **INFO** - Same as MYDATA

### Update Your Information
- **CHANGENAME [new name]** - Update your name
  - Example: `CHANGENAME Stephen`
- **RESET** - Clear your drink preferences (keeps your name)

### Privacy & Deletion
- **DELETE** - Remove all your data from the system
- **FORGET ME** - Same as DELETE
- **STOP** - Opt out and delete your data

### Help
- **HELP** - Get list of available commands
- **COMMANDS** - Same as HELP

## Implementation Examples

### Customer texts: "MYDATA"
Response:
```
Your Coffee Cue Profile:
Name: Stephen
Favorite: Flat white with oat milk (medium)
Orders: 15 total
Member since: Jan 2024

Text RESET to clear preferences or DELETE to remove all data.
```

### Customer texts: "CHANGENAME Steve"
Response:
```
✅ Name updated to: Steve
Your next order will use this name.
```

### Customer texts: "RESET"
Response:
```
✅ Preferences cleared!
We'll ask for your order details next time.
Your name (Steve) is still saved.
```

### Customer texts: "DELETE"
Response:
```
⚠️ This will delete all your data.
Reply YES to confirm deletion or NO to cancel.
```

## Admin/Support Tools

### Via Support Interface
1. **Customer Data Manager** - Full GUI for managing customer data
2. **Search by phone/name**
3. **Bulk operations** for events
4. **Export data** for GDPR compliance
5. **Anonymize old data** for privacy

### Command Line Tools
```bash
# Interactive customer data manager
python customer_data_manager.py

# Bulk delete inactive customers (90+ days)
python customer_data_manager.py --delete-all-inactive 90

# Fix customer names after friend order bug
python fix_customer_names.py
```

## Privacy Best Practices

1. **Event-Based Cleanup**
   - After each event, consider deleting customer data
   - Or anonymize data older than 1 year

2. **Cross-Event Considerations**
   - Same system at multiple venues = shared customer data
   - Consider separate databases per venue/event

3. **Data Retention Policy**
   - Automatic deletion after X days of inactivity
   - Regular anonymization of old data
   - Clear privacy policy in SMS responses

4. **Customer Rights (GDPR)**
   - Right to access their data (MYDATA)
   - Right to correction (CHANGENAME)
   - Right to erasure (DELETE)
   - Right to data portability (export feature)