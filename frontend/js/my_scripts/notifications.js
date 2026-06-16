document.addEventListener('DOMContentLoaded', () => {
    const ipAddress = "192.168.1.20";
    const notificationsContainer = document.querySelector('.card-body');
    const governorateSelect = document.querySelector('#governorateSelect');
    const filterBtn = document.querySelector('#filterButton');
    const params = new URLSearchParams(window.location.search);
    const nodeId = params.get('node_id');

    // Fetch notifications from the API
    function loadNotifications(governorate = '',node_id = '') {
        let url = `http://${ipAddress}:5000/api/notifications`;
        const params = [];

        if (governorate) params.push(`governorate=${encodeURIComponent(governorate)}`);
        if (node_id) params.push(`node_id=${encodeURIComponent(node_id)}`);

        if (params.length > 0) {
            url += `?${params.join('&')}`;
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

                renderNotifications(data.data);
            })
            .catch(error => {
                console.error('Error:', error);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'alert alert-danger';
                errorDiv.textContent = `Error loading data: ${error.message}`;
                document.querySelector('.card-body').prepend(errorDiv);
            });
    }

    function renderNotifications(notifications) {
        notifications.sort((a, b) => new Date(b.time) - new Date(a.time));

        // Clear existing content
        notificationsContainer.innerHTML = '';

        if (notifications.length === 0) {
            notificationsContainer.innerHTML = '<p>No notifications found</p>';
            return;
        }

        notifications.forEach(notification => {
            const notificationElement = document.createElement('div');
            notificationElement.className = 'notification-item py-2';

            notificationElement.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <div>
                        <h6 class="mb-1 mx-0 text-sm">${notification.content}</h6>
                        <p class="text-xs text-secondary my-0 mx-0">${notification.governorate} - ${notification.address}</p>
                    </div>
                    <div>
                        <p class="text-xs font-weight-bold mb-0">${new Date(notification.time).toLocaleString()}</p>
                    </div>
                </div>
                <hr class="dark horizontal mb-2">
            `;

            notificationsContainer.appendChild(notificationElement);
        });
    }

    if (nodeId){
        loadNotifications("",nodeId);
    }else{
        loadNotifications("","");
    }
    

    // Handle filter click
    filterBtn.addEventListener('click', function () {
        const selectedGovernorate = governorateSelect.value;
        loadNotifications(selectedGovernorate, nodeId);
    });

});