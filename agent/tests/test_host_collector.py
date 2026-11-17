import socket
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from collectors.host import collect_host_metrics


class HostCollectorTests(unittest.TestCase):
    @patch("collectors.host.platform.machine", return_value="x86_64")
    @patch("collectors.host.platform.release", return_value="test-release")
    @patch("collectors.host.platform.system", return_value="Linux")
    @patch("collectors.host.psutil.cpu_percent", return_value=12.5)
    @patch("collectors.host.psutil.virtual_memory", return_value=SimpleNamespace(percent=45.0))
    @patch("collectors.host.psutil.disk_usage", return_value=SimpleNamespace(percent=60.0))
    @patch("collectors.host.psutil.net_io_counters", return_value=SimpleNamespace(bytes_sent=100, bytes_recv=200))
    @patch("collectors.host.psutil.net_if_stats", return_value={"eth0": SimpleNamespace(isup=True, speed=1000, mtu=1500)})
    @patch("collectors.host.psutil.net_if_addrs", return_value={"eth0": [SimpleNamespace(family=socket.AF_INET, address="192.0.2.10")]})
    def test_normalizes_host_and_interface_metrics(self, *_mocks):
        result = collect_host_metrics()
        self.assertEqual(result["platform"], "Linux")
        self.assertEqual(result["cpu_percent"], 12.5)
        self.assertEqual(result["interfaces"][0]["name"], "eth0")
        self.assertEqual(result["interfaces"][0]["ipv4"], ["192.0.2.10"])
        self.assertEqual(result["interfaces"][0]["speed_mbps"], 1000)


if __name__ == "__main__":
    unittest.main()
