// components/dialogs/WaitTimeDialog.js
//
// The wait time shown to customers on the board and in texts. A barista
// nudges it when the queue is longer or shorter than the maths thinks.
import React, { useState } from 'react';
import { Clock } from 'lucide-react';
import { Modal, Button, SettingGroup, SettingRow, TextField, SettingNote } from '../../design';

const WaitTimeDialog = ({ currentWaitTime, onSubmit, onClose }) => {
  const [waitTime, setWaitTime] = useState(currentWaitTime);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(waitTime);
  };

  return (
    <Modal
      title="Adjust wait time"
      Icon={Clock}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit}>Update</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <SettingGroup>
          <SettingRow
            Icon={Clock}
            label="Minutes to wait"
            hint={`Currently telling customers ${currentWaitTime} minutes`}
          >
            <TextField
              type="number"
              min="1"
              max="60"
              value={waitTime}
              onChange={(v) => setWaitTime(parseInt(v, 10) || 1)}
              required
            />
          </SettingRow>
        </SettingGroup>
        <SettingNote>
          This is what the board shows and what a new customer is told when
          they order. It does not change any order already placed.
        </SettingNote>
      </form>
    </Modal>
  );
};

export default WaitTimeDialog;
