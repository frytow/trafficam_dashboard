document.addEventListener('DOMContentLoaded', function () {
    ipAddress = "192.168.100.6"
    const tableBody = document.querySelector('#intersectionsTable tbody');
    const filterBtn = document.getElementById('filterBtn');
    const governorateSelect = document.getElementById('governorateSelect');
    const deleteBtn = document.getElementById('deleteBtn');
    const editBtn = document.getElementById('editBtn');
    const deleteConfirmModal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteAddressSpan = document.getElementById('deleteAddress');
    let selectedIntersection = null;

    function loadIntersections(governorate = '') {
        let url = `http://${ipAddress}:5000/api/intersections/filter`;
        if (governorate) {
            url += `?governorate=${encodeURIComponent(governorate)}`;
        }

        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data.success) {
                    throw new Error(data.error || 'Failed to load data');
                }

                console.log('Intersections API response:', data);
                tableBody.innerHTML = '';

                data.data.forEach(intersection => {
                    const lat = parseFloat(intersection.latitude);
                    const lng = parseFloat(intersection.longitude);
                    const capacity = parseInt(intersection.capacity) || 0;
                    const cams = parseInt(intersection.cams);
                    const lanes = parseInt(intersection.total_lanes) || 0;

                    fetch(`http://${ipAddress}:5000/api/nodes?intersection_id=${intersection.id}`)
                        .then(res => {
                            if (!res.ok) {
                                throw new Error(`HTTP error! status: ${res.status}`);
                            }
                            return res.json();
                        })
                        .then(nodeData => {
                            console.log(`Nodes API response for intersection_id=${intersection.id}:`, nodeData);
                            const nodeId = nodeData.success && nodeData.data.length > 0 ? nodeData.data[0].id : null;
                            console.log(`Assigning nodeId=${nodeId} for intersection address=${intersection.address}`);
                            const row = document.createElement('tr');
                            row.dataset.lat = lat;
                            row.dataset.lng = lng;
                            row.dataset.address = intersection.address;
                            row.dataset.capacity = capacity;
                            row.dataset.nodeId = nodeId;
                            row.innerHTML = `
                                <td>
                                    <div class="d-flex px-2 py-1">
                                        <div class="d-flex flex-column justify-content-center">
                                            <h6 class="mb-0 text-sm">${intersection.address || 'N/A'}</h6>
                                            <p class="text-xs text-secondary mb-0">Traffic Intersection</p>
                                        </div>
                                    </div>
                                </td>
                                <td><p class="text-xs font-weight-bold mb-0">${!isNaN(lat) ? lat.toFixed(6) : 'N/A'}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${!isNaN(lng) ? lng.toFixed(6) : 'N/A'}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${cams}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${capacity}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${lanes}</p></td>
                            `;
                            row.addEventListener('click', () => {
                                if (selectedIntersection) {
                                    selectedIntersection.classList.remove('table-active');
                                }
                                row.classList.add('table-active');
                                selectedIntersection = row;
                                console.log('Selected intersection dataset:', row.dataset);
                                deleteBtn.disabled = false;
                                editBtn.disabled = false;
                            });
                            tableBody.appendChild(row);
                        })
                        .catch(error => {
                            console.error(`Error fetching node_id for intersection_id=${intersection.id}:`, error);
                            const row = document.createElement('tr');
                            row.dataset.lat = lat;
                            row.dataset.lng = lng;
                            row.dataset.address = intersection.address;
                            row.dataset.capacity = capacity;
                            row.innerHTML = `
                                <td>
                                    <div class="d-flex px-2 py-1">
                                        <div class="d-flex flex-column justify-content-center">
                                            <h6 class="mb-0 text-sm">${intersection.address || 'N/A'}</h6>
                                            <p class="text-xs text-secondary mb-0">Traffic Intersection</p>
                                        </div>
                                    </div>
                                </td>
                                <td><p class="text-xs font-weight-bold mb-0">${!isNaN(lat) ? lat.toFixed(6) : 'N/A'}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${!isNaN(lng) ? lng.toFixed(6) : 'N/A'}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${cams}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${capacity}</p></td>
                                <td class="align-middle text-center"><p class="text-xs font-weight-bold mb-0">${lanes}</p></td>
                            `;
                            row.addEventListener('click', () => {
                                if (selectedIntersection) {
                                    selectedIntersection.classList.remove('table-active');
                                }
                                row.classList.add('table-active');
                                console.log('Selected intersection dataset (fallback):', row.dataset);
                                selectedIntersection = row;
                                deleteBtn.disabled = false;
                                editBtn.disabled = false;
                            });
                            tableBody.appendChild(row);
                        });
                });
            })
            .catch(error => {
                console.error('Error loading intersections:', error);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'alert alert-danger';
                errorDiv.textContent = `Error loading data: ${error.message}`;
                document.querySelector('.card-body').prepend(errorDiv);
            });
    }

    loadIntersections();

    filterBtn.addEventListener('click', function () {
        const selectedGovernorate = governorateSelect.value;
        console.log('Filtering by governorate:', selectedGovernorate);
        loadIntersections(selectedGovernorate);
        selectedIntersection = null;
        deleteBtn.disabled = true;
        editBtn.disabled = true;
    });

    editBtn.addEventListener('click', function () {
        if (selectedIntersection) {
            const lat = selectedIntersection.dataset.lat;
            const lng = selectedIntersection.dataset.lng;
            console.log('Edit button clicked for lat:', lat, 'lng:', lng);
            fetch(`http://${ipAddress}:5000/api/cams/by_intersection?lat=${lat}&lng=${lng}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('Cams API response for lat=', lat, 'lng=', lng, ':', data);
                    if (!data.success || !data.data || data.data.length === 0) {
                        throw new Error('No cameras found for this intersection');
                    }
                    const cameraUrl = data.data[0].ip_address;
                    try {
                        const url = new URL(cameraUrl);
                        const newUrl = `${url.protocol}//${url.hostname}:8081/reconfig`;
                        console.log('Opening URL:', newUrl);
                        window.open(newUrl, '_blank');
                    } catch (e) {
                        throw new Error('Invalid camera URL format');
                    }
                })
                .catch(error => {
                    console.error('Error in editBtn handler:', error);
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'alert alert-danger';
                    errorDiv.textContent = `Error: ${error.message}`;
                    document.querySelector('.card-body').prepend(errorDiv);
                    setTimeout(() => errorDiv.remove(), 3000);
                });
        } else {
            console.error('No intersection selected');
            const errorDiv = document.createElement('div');
            errorDiv.className = 'alert alert-danger';
            errorDiv.textContent = 'Please select an intersection first';
            document.querySelector('.card-body').prepend(errorDiv);
            setTimeout(() => errorDiv.remove(), 3000);
        }
    });

    deleteBtn.addEventListener('click', function () {
        if (selectedIntersection) {
            console.log('Delete button clicked for address:', selectedIntersection.dataset.address);
            deleteAddressSpan.textContent = selectedIntersection.dataset.address || 'this intersection';
            deleteConfirmModal.show();
        }
    });

    confirmDeleteBtn.addEventListener('click', function () {
        if (selectedIntersection) {
            const lat = selectedIntersection.dataset.lat;
            const lng = selectedIntersection.dataset.lng;
            console.log('Confirm delete for lat=', lat, 'lng=', lng);
            fetch(`http://${ipAddress}:5000/api/intersections/delete`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ latitude: lat, longitude: lng })
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (!data.success) {
                        throw new Error(data.error || 'Failed to delete intersection');
                    }
                    console.log('Intersection deleted successfully');
                    selectedIntersection.remove();
                    selectedIntersection = null;
                    deleteBtn.disabled = true;
                    editBtn.disabled = true;
                    deleteConfirmModal.hide();
                    const successDiv = document.createElement('div');
                    successDiv.className = 'alert alert-success';
                    successDiv.textContent = 'Intersection deleted successfully';
                    document.querySelector('.card-body').prepend(successDiv);
                    setTimeout(() => successDiv.remove(), 3000);
                })
                .catch(error => {
                    console.error('Error deleting intersection:', error);
                    deleteConfirmModal.hide();
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'alert alert-danger';
                    errorDiv.textContent = `Error deleting intersection: ${error.message}`;
                    document.querySelector('.card-body').prepend(errorDiv);
                });
        }
    });
});