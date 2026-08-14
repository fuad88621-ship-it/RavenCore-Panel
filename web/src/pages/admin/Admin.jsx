import React from 'react';
import { useLocation } from 'react-router-dom';
import Overview from './Overview.jsx';
import Settings from './Settings.jsx';
import ApiKeys from './ApiKeys.jsx';
import Databases from './Databases.jsx';
import Locations from './Locations.jsx';
import Nodes from './Nodes.jsx';
import Servers from './Servers.jsx';
import Users from './Users.jsx';
import Mounts from './Mounts.jsx';
import Nests from './Nests.jsx';

export default function Admin() {
  const { pathname } = useLocation();
  const section = pathname.replace('/admin', '').split('/')[1] || 'overview';

  switch (section) {
    case 'settings': return <Settings />;
    case 'api-keys': return <ApiKeys />;
    case 'databases': return <Databases />;
    case 'locations': return <Locations />;
    case 'nodes': return <Nodes />;
    case 'servers': return <Servers />;
    case 'users': return <Users />;
    case 'mounts': return <Mounts />;
    case 'nests': return <Nests />;
    default: return <Overview />;
  }
}
