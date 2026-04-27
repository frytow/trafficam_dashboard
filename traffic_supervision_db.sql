-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: May 06, 2025 at 02:47 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `traffic_control_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `cams`
--

CREATE TABLE `cams` (
  `id` int(11) NOT NULL,
  `node_id` int(11) NOT NULL,
  `lanes` int(11) NOT NULL,
  `ip_address` varchar(55) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `history`
--

CREATE TABLE `history` (
  `intersection_id` int(11) NOT NULL,
  `time_stamps` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `vehicles_count` int(11) NOT NULL,
  `total_passed` int(11) NOT NULL,
  `avg_speed` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `intersections`
--

CREATE TABLE `intersections` (
  `id` int(11) NOT NULL,
  `governorate` varchar(11) NOT NULL,
  `address` varchar(55) NOT NULL,
  `latitude` decimal(10,6) NOT NULL,
  `longitude` decimal(10,6) NOT NULL,
  `capacity` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `nodes`
--

CREATE TABLE `nodes` (
  `id` int(11) NOT NULL,
  `intersection_id` int(11) NOT NULL,
  `cams` int(1) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `intersection_id` int(11) NOT NULL,
  `severety` int(1) NOT NULL,
  `content` varchar(40) NOT NULL,
  `time` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;


--
-- Indexes for table `cams`
--
ALTER TABLE `cams`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_cams_nodes` (`node_id`);

--
-- Indexes for table `history`
--
ALTER TABLE `history`
  ADD KEY `fk_history` (`intersection_id`);

--
-- Indexes for table `intersections`
--
ALTER TABLE `intersections`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `nodes`
--
ALTER TABLE `nodes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_nodes_intersection_id` (`intersection_id`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD KEY `fk_notif_node_id` (`intersection_id`);


--
-- AUTO_INCREMENT for table `cams`
--
ALTER TABLE `cams`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12383;

--
-- AUTO_INCREMENT for table `intersections`
--
ALTER TABLE `intersections`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2029;

--
-- AUTO_INCREMENT for table `nodes`
--
ALTER TABLE `nodes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2029;

--
-- Constraints for table `cams`
--
ALTER TABLE `cams`
  ADD CONSTRAINT `fk_cams_nodes` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `history`
--
ALTER TABLE `history`
  ADD CONSTRAINT `fk_history` FOREIGN KEY (`intersection_id`) REFERENCES `intersections` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `nodes`
--
ALTER TABLE `nodes`
  ADD CONSTRAINT `fk_nodes_intersection_id` FOREIGN KEY (`intersection_id`) REFERENCES `intersections` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `fk_notif_node_id` FOREIGN KEY (`intersection_id`) REFERENCES `intersections` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
